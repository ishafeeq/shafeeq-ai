import json
import logging
import time
from langchain_core.messages import HumanMessage, SystemMessage
from .state import SAIState
from .prompts import _INTENT_ROUTER_SYSTEM, _QUERY_REFINER_SYSTEM, _FILTER_SYSTEM
from .tools import _llm, _extract_json, _recent_context, _tavily_search, _pgvector_search

logger = logging.getLogger(__name__)

# Core Model Config
# Core Model Config - Pulled from docker-compose.yml
import os
GUARDRAIL_MODEL = os.environ.get("GROQ_GUARDRAIL_MODEL", "openai/gpt-oss-20b")
logger.info(f"[LLM_CONFIG] Guardrail Model: {GUARDRAIL_MODEL}")

def _get_usage(resp) -> tuple[int, int]:
    if hasattr(resp, "usage_metadata") and resp.usage_metadata:
        return resp.usage_metadata.get("input_tokens", 0), resp.usage_metadata.get("output_tokens", 0)
    return 0, 0

def node_intent_router(state: SAIState) -> dict:
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
        pt, ct = _get_usage(resp)
        if intent not in ("WEB", "RAG", "DIRECT"):
            intent = "DIRECT"
        if reasoning_level not in ("low", "med", "high"):
            reasoning_level = "med"
    except Exception as e:
        logger.error(f"[IntentRouter] Error: {e}")
        intent, reasoning_level, pt, ct = "DIRECT", "med", 0, 0

    logger.info(f"[IntentRouter] intent={intent} reasoning_level={reasoning_level}")
    return {"intent": intent, "reasoning_level": reasoning_level, "usage_20b_calls": [{"node": "intent_router", "prompt": pt, "completion": ct}]}


def node_query_refiner(state: SAIState) -> dict:
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
        pt, ct  = _get_usage(resp)
        if not isinstance(queries, list) or not queries:
            queries = [last_human]
    except Exception as e:
        logger.error(f"[QueryRefiner] Error: {e}")
        queries, pt, ct = [last_human], 0, 0

    logger.info(f"[QueryRefiner] Generated {len(queries)} queries: {queries}")
    return {"search_queries": queries, "usage_20b_calls": [{"node": "query_refiner", "prompt": pt, "completion": ct}]}


async def node_web_search(state: SAIState) -> dict:
    queries = state.get("search_queries", [])
    t0 = time.time()
    raw     = await _tavily_search(queries)
    duration = time.time() - t0
    logger.info(f"[WebSearch] Retrieved {len(raw)} chars in {duration:.2f}s")
    return {"raw_context": raw, "tavily_search_time_sec": duration}


async def node_rag_search(state: SAIState) -> dict:
    queries = state.get("search_queries", [])
    raw     = _pgvector_search(queries)
    logger.info(f"[RAG] Retrieved {len(raw)} chars")
    return {"raw_context": raw}


def node_context_filter(state: SAIState) -> dict:
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
        pt, ct   = _get_usage(resp)
    except Exception as e:
        logger.error(f"[ContextFilter] Error: {e}")
        filtered, pt, ct = raw[:2000], 0, 0

    logger.info(f"[ContextFilter] Pruned to {len(filtered)} chars")
    return {"tool_context": filtered, "usage_20b_calls": [{"node": "context_filter", "prompt": pt, "completion": ct}]}
