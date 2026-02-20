"""
agent_brain.py — LangGraph-based Agentic Brain for Bol AI
==========================================================
Architecture: Single-node LangGraph with pre-routing.

Since deepseek-r1:7b via Ollama does not support OpenAI-style tool calling,
we use a "router-first" pattern:
  1. Detect if the query needs web search (keywords + heuristics)
  2. If yes → run Tavily search → inject results into context → call DeepSeek-R1
  3. If no  → call DeepSeek-R1 directly with history + user context

This gives us the agentic "search when needed" behaviour without requiring
native function-calling support from the model.
"""

import os
import re
import logging
from typing import Annotated, List, Optional, Sequence

from dotenv import load_dotenv
from langchain_core.messages import (
    BaseMessage,
    HumanMessage,
    AIMessage,
    SystemMessage,
)
from langchain_ollama import ChatOllama
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from tavily import TavilyClient
from typing_extensions import TypedDict

load_dotenv()

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "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")

# ── Web Search (Tavily) ───────────────────────────────────────────────────────

_SEARCH_KEYWORDS = [
    "search", "latest", "current", "today", "news", "recent", "2024", "2025", "2026",
    "who is", "what is", "when did", "how much", "price", "weather", "stock",
    "खोजो", "ढूंढो", "आज", "ताज़ा", "खबर",
]

def _needs_search(text: str) -> bool:
    """Heuristic: does this query likely need live web data?"""
    lower = text.lower()
    return any(kw in lower for kw in _SEARCH_KEYWORDS)


def _web_search(query: str) -> str:
    """Run a Tavily search and return a formatted context string."""
    try:
        client = TavilyClient(TAVILY_API_KEY)
        result = client.search(
            query=query,
            include_answer="basic",
            search_depth="advanced",
            max_results=3,
        )
        answer = result.get("answer", "")
        snippets = "\n".join(
            f"• {r.get('title', '')}: {r.get('content', '')[:200]}"
            for r in result.get("results", [])[:3]
        )
        return f"Web search results:\n{answer}\n\n{snippets}".strip()
    except Exception as e:
        logger.error(f"Tavily search failed: {e}")
        return ""


# ── LangGraph State ───────────────────────────────────────────────────────────

class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]


# ── Build the graph ───────────────────────────────────────────────────────────

def _build_graph():
    llm = ChatOllama(
        model="deepseek-r1:7b",
        base_url=OLLAMA_BASE_URL,
        temperature=0.7,
    )

    def call_model(state: AgentState) -> dict:
        response = llm.invoke(state["messages"])
        return {"messages": [response]}

    graph = StateGraph(AgentState)
    graph.add_node("call_model", call_model)
    graph.set_entry_point("call_model")
    graph.add_edge("call_model", END)

    return graph.compile()


_graph = _build_graph()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_think_tags(text: str) -> str:
    """Remove DeepSeek-R1 <think>...</think> chain-of-thought from final output."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


# ── Public API ────────────────────────────────────────────────────────────────

def run_agent(
    conversation_id: int,
    user_name: str,
    user_mobile: str,
    user_text: str,
    history: Optional[List[dict]] = None,
) -> str:
    """
    Run the agentic brain and return the assistant's response text.

    Args:
        conversation_id: DB conversation ID (for logging)
        user_name:        User's full name from JWT
        user_mobile:      User's mobile number from JWT
        user_text:        Current user message (English from Sarvam STT)
        history:          Prior messages as [{"role": "user"|"assistant", "content": "..."}]
    """
    name = user_name or "there"
    mobile = user_mobile or ""

    # 1. Pre-routing: check if web search is needed
    search_context = ""
    if _needs_search(user_text):
        logger.info(f"[Agent] Web search triggered for: '{user_text[:60]}'")
        search_context = _web_search(user_text)
        if search_context:
            logger.info(f"[Agent] Search context retrieved ({len(search_context)} chars)")

    # 2. Build system prompt
    system_parts = [
        f"You are Bol AI, a smart and concise voice assistant.",
        f"You are currently helping {name} (mobile: {mobile}).",
        "Always respond in clear, spoken English — no markdown, no bullet points, no code blocks unless explicitly asked.",
        "Keep responses short and conversational (2-4 sentences max unless the user asks for detail).",
        "You understand Hinglish input natively.",
    ]
    if search_context:
        system_parts.append(
            f"\nHere is relevant web search context to help answer the user's question:\n{search_context}"
        )
    system_prompt = " ".join(system_parts)

    # 3. Build message list: system + history + current user message
    messages: List[BaseMessage] = [SystemMessage(content=system_prompt)]

    for msg in (history or []):
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))

    messages.append(HumanMessage(content=user_text))

    logger.info(f"[Agent] conv={conversation_id} user={name} input='{user_text[:80]}'")

    # 4. Run LangGraph
    try:
        result = _graph.invoke({"messages": messages})
        final_msg = result["messages"][-1]
        response_text = _strip_think_tags(final_msg.content)
        logger.info(f"[Agent] response='{response_text[:80]}'")
        return response_text
    except Exception as e:
        logger.error(f"[Agent] Error: {e}")
        return "I'm sorry, I couldn't process that right now. Please try again."
