"""
graph.py — Production LangGraph Agent for Bol AI (GPT-OSS Edition)
===================================================================

Node pipeline:
  START
    → intent_router   (20B: classify intent → WEB|RAG|DIRECT + reasoning_level low|med|high)
    → query_refiner   (20B: transliterate text via Sarvam, generate 3 optimised queries) [skipped if DIRECT]
    → [web_search | rag_search]                                                           [skipped if DIRECT]
    → context_filter  (20B: prune results to 500-1000 tokens)                            [skipped if DIRECT]
    → research_synthesize (120B: final Hinglish TTS-ready response)
    → END

Models:
  Routing & Guardrail layer → Groq openai/gpt-oss-20b   (~1000 tps, ultra-fast)
  Reasoning & Synthesis     → Groq openai/gpt-oss-120b  (maximum capability)

Input contract:
  user_text MUST be English-translated output from Sarvam Saaras-v3 STT (translate mode).
  query_refiner will call Sarvam translit mode to get the Hinglish/Devanagari form for
  better search query generation.
"""

import os
import re
import json
import logging
from typing import Annotated, List, Optional

from dotenv import load_dotenv
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_groq import ChatGroq
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from tavily import TavilyClient
from typing_extensions import TypedDict

load_dotenv()
logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

GROQ_API_KEY    = os.environ["GROQ_API_KEY"]
SARVAM_API_KEY  = os.environ["SARVAM_API_KEY"]
TAVILY_API_KEY  = os.environ["TAVILY_API_KEY"]
DATABASE_URL    = os.environ["DATABASE_URL"]
OLLAMA_BASE_URL = os.environ["OLLAMA_BASE_URL"]

# Groq model IDs — GPT-OSS series
GUARDRAIL_MODEL   = "openai/gpt-oss-20b"     # Routing & utility layer (131k ctx, ~1000 tps)
SYNTHESIZER_MODEL = "openai/gpt-oss-120b"    # Reasoning & synthesis layer (max capability)

# Context window limits (in tokens). 1 token ≈ 4 chars (conservative).
CTX_LIMIT_TOKENS  = 131_072
CHARS_PER_TOKEN   = 4
CTX_LIMIT_CHARS   = CTX_LIMIT_TOKENS * CHARS_PER_TOKEN  # 524,288 chars

# Current date injected into synthesizer to prevent stale knowledge disclaimers
CURRENT_DATE = "February 2026"


# ── State ─────────────────────────────────────────────────────────────────────

class BolState(TypedDict):
    messages:        Annotated[List[BaseMessage], add_messages]
    user_name:       str
    user_mobile:     str
    intent:          str           # WEB | RAG | DIRECT
    reasoning_level: str           # low | med | high
    translit_text:   str           # Sarvam transliterated form of user query
    search_queries:  List[str]     # 3 optimised queries from query_refiner
    raw_context:     str           # raw results from web/rag
    tool_context:    str           # filtered/pruned context from context_filter


# ── Groq client factory ───────────────────────────────────────────────────────

def _llm(model: str, temperature: float = 0) -> ChatGroq:
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set. Add it to backend/.env")
    return ChatGroq(api_key=GROQ_API_KEY, model=model, temperature=temperature)


# ── External search tools ─────────────────────────────────────────────────────

def _tavily_search(queries: List[str]) -> str:
    """Run up to 3 Tavily searches and concatenate raw results."""
    try:
        client = TavilyClient(TAVILY_API_KEY)
        all_results = []
        for q in queries[:3]:
            result = client.search(
                query=q,
                include_answer="basic",
                search_depth="advanced",
                max_results=3,
            )
            answer   = result.get("answer", "")
            snippets = "\n".join(
                f"[{r.get('title','')}] {r.get('content','')[:300]}"
                for r in result.get("results", [])[:3]
            )
            all_results.append(f"Query: {q}\nAnswer: {answer}\n{snippets}")
        return "\n\n---\n\n".join(all_results)
    except Exception as e:
        logger.error(f"[WebSearch] Tavily error: {e}")
        return ""


def _pgvector_search(queries: List[str]) -> str:
    """Search pgvector store with multiple queries and deduplicate results."""
    try:
        from langchain_postgres import PGVector
        from langchain_ollama import OllamaEmbeddings

        embeddings = OllamaEmbeddings(model="mxbai-embed-large", base_url=OLLAMA_BASE_URL)
        store = PGVector(
            embeddings=embeddings,
            collection_name="bol_ai_docs",
            connection=DATABASE_URL,
        )
        seen, chunks = set(), []
        for q in queries[:3]:
            docs = store.similarity_search(q, k=3)
            for d in docs:
                key = d.page_content[:80]
                if key not in seen:
                    seen.add(key)
                    chunks.append(
                        f"[{d.metadata.get('source','?')}]\n{d.page_content[:400]}"
                    )
        return "\n\n".join(chunks) if chunks else ""
    except Exception as e:
        logger.warning(f"[RAG] Search failed: {e}")
        return ""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_json(text: str) -> dict:
    """Robustly extract the first JSON object from a model response."""
    # Try to find JSON inside markdown code fences first
    fence = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if fence:
        try:
            return json.loads(fence.group(1))
        except json.JSONDecodeError:
            pass
    match = re.search(r'\{.*?\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {}


def _recent_context(
    messages: List[BaseMessage],
    n_turns: int = 6,
    reserved_chars: int = 8_000,   # chars reserved for system prompt + current query + response
) -> str:
    """
    Format the last n_turns of conversation (excluding the current message)
    for the router and query_refiner.

    Strategy:
    1. Take up to n_turns pairs (12 messages) of prior history.
    2. Estimate total char length of all messages.
    3. If total fits within (CTX_LIMIT_CHARS - reserved_chars), include full content.
    4. Otherwise, truncate each message proportionally so the total stays within budget.
    """
    prior  = [m for m in messages[:-1] if isinstance(m, (HumanMessage, AIMessage))]
    recent = prior[-(n_turns * 2):]
    if not recent:
        return ""

    budget = CTX_LIMIT_CHARS - reserved_chars  # chars available for history

    # Build lines with full content first
    lines = []
    for m in recent:
        role = "User" if isinstance(m, HumanMessage) else "Assistant"
        lines.append((role, m.content))

    total_chars = sum(len(role) + 2 + len(content) for role, content in lines)

    if total_chars <= budget:
        # Full content fits — no truncation needed
        return "\n".join(f"{role}: {content}" for role, content in lines)

    # Proportional truncation: give each message a fair share of the budget
    per_msg_budget = max(200, budget // len(lines))  # at least 200 chars per message
    result = []
    for role, content in lines:
        if len(content) > per_msg_budget:
            content = content[:per_msg_budget] + "…"
        result.append(f"{role}: {content}")
    return "\n".join(result)


# ── Node 1: intent_router (20B) ───────────────────────────────────────────────

_INTENT_ROUTER_SYSTEM = """\
You are a routing and guardrail agent for a voice AI assistant.

Your job: classify the user's query and determine reasoning complexity.

IMPORTANT: Use the conversation history to resolve implicit references and follow-up questions.
Example: if the user asked about Eid and now asks "alvidah date", classify as WEB (Eid-related).

Output ONLY a valid JSON object. No explanation, no markdown, no extra text.

Schema: {"intent": "WEB|RAG|DIRECT", "reasoning_level": "low|med|high"}

Intent rules:
- WEB: needs live/current data (news, prices, events, weather, sports, "latest", "today", "2025", "2026")
- RAG: needs info from local project code, files, or documentation
- DIRECT: answerable from general knowledge (math, definitions, conversation, advice)

Reasoning level rules:
- low: simple factual lookup or greeting
- med: multi-step or comparative question
- high: complex analysis, code generation, or multi-part research

Examples:
{"intent": "DIRECT", "reasoning_level": "low"}   ← "What is 2 + 2?"
{"intent": "WEB", "reasoning_level": "med"}       ← "When is Eid this year in India?"
{"intent": "WEB", "reasoning_level": "low"}       ← "alvidah date?" (after Eid discussion)
{"intent": "RAG", "reasoning_level": "high"}      ← "Explain the auth flow in my project"
{"intent": "DIRECT", "reasoning_level": "high"}   ← "Write a Python async web scraper"
"""

def node_intent_router(state: BolState) -> dict:
    last_human = next(
        (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), ""
    )
    context    = _recent_context(state["messages"], n_turns=3)
    user_block = (
        f"Recent conversation:\n{context}\n\nCurrent query: \"{last_human}\""
        if context else
        f"User query: \"{last_human}\""
    )
    try:
        resp = _llm(GUARDRAIL_MODEL).invoke([
            SystemMessage(content=_INTENT_ROUTER_SYSTEM),
            HumanMessage(content=user_block),
        ])
        data           = _extract_json(resp.content)
        intent         = data.get("intent", "DIRECT").upper()
        reasoning_level = data.get("reasoning_level", "med").lower()
        if intent not in ("WEB", "RAG", "DIRECT"):
            intent = "DIRECT"
        if reasoning_level not in ("low", "med", "high"):
            reasoning_level = "med"
    except Exception as e:
        logger.error(f"[IntentRouter] Error: {e}")
        intent, reasoning_level = "DIRECT", "med"

    logger.info(f"[IntentRouter] intent={intent} reasoning_level={reasoning_level}")
    return {"intent": intent, "reasoning_level": reasoning_level}


# ── Node 2: query_refiner (20B) ───────────────────────────────────────────────

_QUERY_REFINER_SYSTEM = """\
You are a search query optimizer and text clarity agent for a voice AI.

You receive:
1. The user's audio-translated English text (may be noisy or unclear)
2. The Hinglish/Devanagari transliteration of the same audio (for context)
3. Recent conversation history (to resolve implicit references)
4. The search type: WEB or RAG

Your tasks:
A) Check the English text for clarity. If it's garbled or unclear, use the transliteration
   and conversation history to infer the correct meaning.
B) Generate exactly 3 optimised search queries that will retrieve the most relevant results.
   Use conversation history to expand vague references (e.g. "alvidah date" after Eid discussion
   → "Alvida Jumma Eid al-Fitr date 2026 India").

Output ONLY a valid JSON object. No explanation, no markdown.
Schema: {"queries": ["query1", "query2", "query3"], "clarified_text": "cleaned version of user query"}
"""

def node_query_refiner(state: BolState) -> dict:
    last_human    = next(
        (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), ""
    )
    intent        = state.get("intent", "DIRECT")
    translit_text = state.get("translit_text", "")
    context       = _recent_context(state["messages"], n_turns=3)

    user_block = f"Search type: {intent}\n"
    if context:
        user_block += f"Recent conversation:\n{context}\n\n"
    user_block += f"English text (from STT translate): \"{last_human}\"\n"
    if translit_text:
        user_block += f"Hinglish transliteration (from STT translit): \"{translit_text}\"\n"

    try:
        resp    = _llm(GUARDRAIL_MODEL).invoke([
            SystemMessage(content=_QUERY_REFINER_SYSTEM),
            HumanMessage(content=user_block),
        ])
        data    = _extract_json(resp.content)
        queries = data.get("queries", [last_human])
        if not isinstance(queries, list) or not queries:
            queries = [last_human]
    except Exception as e:
        logger.error(f"[QueryRefiner] Error: {e}")
        queries = [last_human]

    logger.info(f"[QueryRefiner] Generated {len(queries)} queries: {queries}")
    return {"search_queries": queries}


# ── Node 3a: web_search ───────────────────────────────────────────────────────

def node_web_search(state: BolState) -> dict:
    queries = state.get("search_queries", [])
    raw     = _tavily_search(queries)
    logger.info(f"[WebSearch] Retrieved {len(raw)} chars")
    return {"raw_context": raw}


# ── Node 3b: rag_search ───────────────────────────────────────────────────────

def node_rag_search(state: BolState) -> dict:
    queries = state.get("search_queries", [])
    raw     = _pgvector_search(queries)
    logger.info(f"[RAG] Retrieved {len(raw)} chars")
    return {"raw_context": raw}


# ── Node 4: context_filter (20B) ─────────────────────────────────────────────

_FILTER_SYSTEM = """\
You are a context pruning agent. You receive raw search results or code snippets.
Extract ONLY the information directly relevant to the user's question.

Rules:
- Strip all HTML, boilerplate, navigation text, ads, and irrelevant content
- Keep only factual, relevant information
- Output must be 500-1000 tokens of clean, dense prose
- Preserve specific facts: dates, numbers, names, URLs
- Do NOT add commentary or your own analysis
- Output plain text only, no markdown
"""

def node_context_filter(state: BolState) -> dict:
    raw        = state.get("raw_context", "")
    last_human = next(
        (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), ""
    )
    if not raw:
        return {"tool_context": ""}
    try:
        resp     = _llm(GUARDRAIL_MODEL, temperature=0).invoke([
            SystemMessage(content=_FILTER_SYSTEM),
            HumanMessage(content=f'User question: "{last_human}"\n\nRaw results:\n{raw[:6000]}'),
        ])
        filtered = resp.content.strip()
    except Exception as e:
        logger.error(f"[ContextFilter] Error: {e}")
        filtered = raw[:2000]

    logger.info(f"[ContextFilter] Pruned to {len(filtered)} chars")
    return {"tool_context": filtered}


# ── Node 5: research_synthesize (120B) ───────────────────────────────────────

_SYNTHESIZE_SYSTEM = """\
You are Bol AI, a smart, warm, and respectful female voice assistant talking to {name}.
Current date: {current_date}.

## Language
- Always respond in Hinglish — a natural mix of Hindi and English the way educated people speak in India.
- ALWAYS use respectful "aap" form (aap, aapko, aapne, aapka) — NEVER use "tu", "tum", "bhai", or "yaar".
- Use respectful connectors: "aap jaante hain", "bilkul", "zaroor", "theek hai", "waise", "lekin", "aur", "toh", "matlab".
- Use English for technical terms, names, dates, and facts.
- Your tone is warm, helpful, and respectful — like a knowledgeable friend who speaks with courtesy.
- Use feminine Hindi grammar: verb endings should match female speaker (e.g., "main bata rahi hoon", "mujhe lagta hai", "main samajhti hoon").
- Example: "Aap bilkul sahi pooch rahe hain. As of now, Eid al-Fitr March 20 ko hai — lekin yeh moon sighting pe depend karta hai, toh ek-do din aage-peeche ho sakta hai."

## Temporal Awareness (STRICT)
- Current date is {current_date}. You are operating in {current_date}.
- NEVER say "as of my knowledge cutoff", "as of 2024", "my training data", or any variation.
- NEVER say "I don't have information beyond [year]".
- For ALL time-sensitive answers, use "As of now" or "Based on current data".
- If the search context contains 2025 or 2026 data, that ALWAYS takes priority. Trust it completely.

## Output Format (CRITICAL — optimised for Sarvam Bulbul-v3 TTS)
- NO markdown whatsoever: no asterisks, no hyphens as bullets, no headers, no code fences
- Convert any lists into flowing Hinglish sentences
- Keep responses concise: 2-5 sentences unless detail is explicitly requested
- Spell out numbers naturally in context ("March twenty" or "teen sau rupaye")
- Be direct and warm — never robotic or overly casual
- If you used search results, weave the key fact naturally into your sentence
"""

def node_research_synthesize(state: BolState) -> dict:
    name    = state.get("user_name", "there")
    context = state.get("tool_context", "")
    intent  = state.get("intent", "DIRECT")

    system_content = _SYNTHESIZE_SYSTEM.format(
        name=name,
        current_date=CURRENT_DATE,
    )
    if context and intent in ("WEB", "RAG"):
        system_content += f"\n\nUse this verified context to answer accurately:\n{context}"

    messages: List[BaseMessage] = [SystemMessage(content=system_content)]
    messages.extend(state["messages"])

    try:
        resp   = _llm(SYNTHESIZER_MODEL, temperature=0.6).invoke(messages)
        answer = resp.content.strip()
        # Strip any accidental markdown symbols
        answer = re.sub(r'\*+', '', answer)
        answer = re.sub(r'^#+\s*', '', answer, flags=re.MULTILINE)
        answer = re.sub(r'^[-•]\s+', '', answer, flags=re.MULTILINE)
        logger.info(f"[Synthesize] response='{answer[:120]}'")
        return {"messages": [AIMessage(content=answer)]}
    except Exception as e:
        logger.error(f"[Synthesize] Error: {e}")
        return {"messages": [AIMessage(content="Yaar, abhi kuch technical issue aa gaya. Thodi der mein try karo.")]}


# ── Routing edges ─────────────────────────────────────────────────────────────

def after_intent_router(state: BolState) -> str:
    """DIRECT intent skips query_refiner and all tools."""
    return "query_refiner" if state.get("intent") in ("WEB", "RAG") else "research_synthesize"

def after_query_refiner(state: BolState) -> str:
    return "web_search" if state.get("intent") == "WEB" else "rag_search"


# ── Build graph ───────────────────────────────────────────────────────────────

def _build_graph():
    g = StateGraph(BolState)

    g.add_node("intent_router",        node_intent_router)
    g.add_node("query_refiner",        node_query_refiner)
    g.add_node("web_search",           node_web_search)
    g.add_node("rag_search",           node_rag_search)
    g.add_node("context_filter",       node_context_filter)
    g.add_node("research_synthesize",  node_research_synthesize)

    g.set_entry_point("intent_router")

    g.add_conditional_edges("intent_router", after_intent_router, {
        "query_refiner":       "query_refiner",
        "research_synthesize": "research_synthesize",
    })
    g.add_conditional_edges("query_refiner", after_query_refiner, {
        "web_search": "web_search",
        "rag_search": "rag_search",
    })
    g.add_edge("web_search",          "context_filter")
    g.add_edge("rag_search",          "context_filter")
    g.add_edge("context_filter",      "research_synthesize")
    g.add_edge("research_synthesize", END)

    return g.compile()


_graph = _build_graph()


# ── Public API ────────────────────────────────────────────────────────────────

def run_graph(
    user_id: int,
    conversation_id: int,
    user_name: str,
    user_mobile: str,
    user_text: str,                         # ← English from Sarvam STT translate mode
    history: Optional[List[dict]] = None,
    translit_text: Optional[str] = None,    # ← Hinglish from Sarvam STT translit mode
) -> str:
    """
    Run the GPT-OSS production LangGraph agent.

    Args:
        user_id:         DB user ID (for thread_id checkpoint key)
        conversation_id: DB conversation ID
        user_name:       From JWT (current_user.full_name)
        user_mobile:     From JWT (current_user.mobile_number)
        user_text:       English text from Sarvam Saaras-v3 STT (translate mode)
        history:         Prior messages [{"role": "user"|"assistant", "content": "..."}]
        translit_text:   Hinglish text from Sarvam STT (translit mode) — from stt_handler

    Returns:
        TTS-ready Hinglish string for Sarvam Bulbul-v3.
    """
    # Build message history
    messages: List[BaseMessage] = []
    for msg in (history or []):
        role, content = msg.get("role", ""), msg.get("content", "")
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))
    messages.append(HumanMessage(content=user_text))

    initial_state: BolState = {
        "messages":        messages,
        "user_name":       user_name or "there",
        "user_mobile":     user_mobile or "",
        "intent":          "DIRECT",
        "reasoning_level": "med",
        "translit_text":   translit_text or "",
        "search_queries":  [],
        "raw_context":     "",
        "tool_context":    "",
    }

    thread_id = f"user_{user_id}_conv_{conversation_id}"
    config    = {"configurable": {"thread_id": thread_id}}
    logger.info(f"[Graph] thread={thread_id} input='{user_text[:80]}'")
    if translit_text:
        logger.info(f"[Graph] translit='{translit_text[:80]}'")

    try:
        result  = _graph.invoke(initial_state, config=config)
        last_ai = next(
            (m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), None
        )
        return last_ai.content if last_ai else "Yaar, kuch problem aa gayi. Dobara try karo."
    except Exception as e:
        logger.error(f"[Graph] Error: {e}")
        return "Yaar, abhi kuch technical issue aa gaya. Thodi der mein try karo."
