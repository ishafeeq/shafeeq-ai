import os
import re
import json
import logging
from typing import List
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_groq import ChatGroq
from tavily import TavilyClient

logger = logging.getLogger(__name__)

# Core Model Config
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY")

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/bol_ai"
)

# Ollama local embeddings
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434")

# Token limits
CTX_LIMIT_TOKENS = 6_000
CTX_LIMIT_CHARS = CTX_LIMIT_TOKENS * 4

def _llm(model: str, temperature: float = 0) -> ChatGroq:
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set. Add it to backend/secrets")
    return ChatGroq(api_key=GROQ_API_KEY, model=model, temperature=temperature)

async def _tavily_search(queries: List[str]) -> str:
    """Run up to 3 Tavily searches in parallel and concatenate raw results."""
    import asyncio
    try:
        logger.info(f"[WebSearch] Calling Tavily API in parallel for queries: {queries[:3]}")
        client = TavilyClient(TAVILY_API_KEY)
        
        async def fetch_search(q):
            return await asyncio.to_thread(
                client.search,
                query=q,
                include_answer="basic",
                search_depth="advanced",
                max_results=3
            )

        tasks = [fetch_search(q) for q in queries[:3]]
        results = await asyncio.gather(*tasks)
        
        all_results = []
        for i, result in enumerate(results):
            q = queries[i]
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

def _extract_json(text: str) -> dict:
    """Robustly extract the first JSON object from a model response."""
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
    reserved_chars: int = 8_000,
) -> str:
    """Format the last n_turns of conversation for the router."""
    prior  = [m for m in messages[:-1] if isinstance(m, (HumanMessage, AIMessage))]
    recent = prior[-(n_turns * 2):]
    if not recent:
        return ""

    budget = CTX_LIMIT_CHARS - reserved_chars

    lines = []
    for m in recent:
        role = "User" if isinstance(m, HumanMessage) else "Assistant"
        lines.append((role, m.content))

    total_chars = sum(len(role) + 2 + len(content) for role, content in lines)

    if total_chars <= budget:
        return "\n".join(f"{role}: {content}" for role, content in lines)

    per_msg_budget = max(200, budget // len(lines))
    result = []
    for role, content in lines:
        if len(content) > per_msg_budget:
            content = content[:per_msg_budget] + "…"
        result.append(f"{role}: {content}")
    return "\n".join(result)
