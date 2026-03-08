import os
import re
import json
import logging
from typing import List
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_openai import ChatOpenAI
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

from opentelemetry import metrics
import time
meter = metrics.get_meter("bol_ai_manual_tokens")
prompt_counter = meter.create_counter("gen_ai_usage_input_tokens")
completion_counter = meter.create_counter("gen_ai_usage_output_tokens")
ttft_histogram = meter.create_histogram("gen_ai_server_time_to_first_token_seconds")

class TrackedChatOpenAI(ChatOpenAI):
    def invoke(self, *args, **kwargs):
        start_t = time.time()
        resp = super().invoke(*args, **kwargs)
        ttft = time.time() - start_t
        ttft_histogram.record(ttft, {"gen_ai_request_model": self.model_name})
        
        if hasattr(resp, "usage_metadata") and resp.usage_metadata:
            usage = resp.usage_metadata
            input_tokens = usage.get("input_tokens", 0)
            output_tokens = usage.get("output_tokens", 0)
            if input_tokens > 0:
                prompt_counter.add(input_tokens, {"gen_ai_request_model": self.model_name})
            if output_tokens > 0:
                completion_counter.add(output_tokens, {"gen_ai_request_model": self.model_name})
            logger.info(f"Langchain 20B tokens: prompt={input_tokens}, completion={output_tokens}")
        return resp

def _llm(model: str, temperature: float = 0) -> ChatOpenAI:
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set. Add it to backend/secrets")
    # Route via our local LiteLLM proxy container
    return TrackedChatOpenAI(
        api_key=os.environ.get("LITELLM_MASTER_KEY"), 
        model=model, 
        temperature=temperature,
        base_url="http://litellm:4000/v1"
    )

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
