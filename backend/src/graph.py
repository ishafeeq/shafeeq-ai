"""
graph.py — Production LangGraph Agent for Bol AI (GPT-OSS Edition)
===================================================================

Node pipeline:
  START
   │
   ▼
intent_router (20B guardrail) ────▶ DIRECT (Chit-chat / math / offline info) ────▶ END
   │
   ▼
(WEB / RAG intent)
   │
   ▼
query_refiner (20B context disambiguation)
   │
   ├────▶ WEB ────▶ web_search (Tavily) ─────────┐
   │                                             │
   └────▶ RAG ────▶ rag_search (pgvector) ───────┤
                                                 │
                                                 ▼
                                           context_filter (20B summarizer)
                                                 │
                                                 ▼
                                                END
"""

import os
import json
import logging
from typing import List, Optional
from datetime import datetime, timezone

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langgraph.graph import StateGraph, END

# Agents imports
from .agents.state import BolState
from .agents.prompts import _SYNTHESIZE_SYSTEM
from .agents.nodes import (
    node_intent_router,
    node_query_refiner,
    node_web_search,
    node_rag_search,
    node_context_filter,
)

logger = logging.getLogger(__name__)

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
SYNTHESIZER_MODEL = os.environ.get("GROQ_SYNTHESIZER_MODEL", "openai/gpt-oss-120b")
logger.info(f"[LLM_CONFIG] Synthesizer Model: {SYNTHESIZER_MODEL}")
CURRENT_DATE = datetime.now(timezone.utc).strftime("%B %d, %Y")

# ── Routing edges ─────────────────────────────────────────────────────────────

def after_intent_router(state: BolState) -> str:
    """DIRECT intent skips query_refiner and all tools."""
    return "query_refiner" if state.get("intent") in ("WEB", "RAG") else "end"

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

    g.set_entry_point("intent_router")

    g.add_conditional_edges("intent_router", after_intent_router, {
        "query_refiner": "query_refiner",
        "end":           END,
    })
    g.add_conditional_edges("query_refiner", after_query_refiner, {
        "web_search": "web_search",
        "rag_search": "rag_search",
    })
    g.add_edge("web_search",          "context_filter")
    g.add_edge("rag_search",          "context_filter")
    g.add_edge("context_filter",      END)

    return g.compile()

_graph = _build_graph()

# ── Public API ────────────────────────────────────────────────────────────────

async def run_context_graph(
    user_id: int,
    conversation_id: int,
    user_name: str,
    user_mobile: str,
    user_text: str,                         # ← English from Sarvam STT translate mode
    history: Optional[List[dict]] = None,
    translit_text: Optional[str] = None,    # ← Hinglish from Sarvam STT translit mode
) -> dict:
    """
    Run the GPT-OSS production LangGraph agent to gather context.
    Returns the final state dictionary.
    """
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
        return await _graph.ainvoke(initial_state, config=config)
    except Exception as e:
        logger.error(f"[Graph] Error: {e}")
        return initial_state

async def stream_synthesize(state: dict):
    user_name = state.get("user_name", "there")
    context   = state.get("tool_context", "")
    intent    = state.get("intent", "DIRECT")

    system_content = _SYNTHESIZE_SYSTEM.format(
        name=user_name,
        current_date=CURRENT_DATE,
    )
    if context and intent in ("WEB", "RAG"):
        system_content += f"\n\nUse this verified context to answer accurately:\n{context}"

    synth_messages: List[BaseMessage] = [SystemMessage(content=system_content)]
    synth_messages.extend(state.get("messages", []))

    from groq import AsyncGroq
    client = AsyncGroq(api_key=GROQ_API_KEY)
    
    # Format messages for native Groq API
    groq_messages = []
    for msg in synth_messages:
        if isinstance(msg, SystemMessage):
            groq_messages.append({"role": "system", "content": msg.content})
        elif isinstance(msg, HumanMessage):
            groq_messages.append({"role": "user", "content": msg.content})
        elif isinstance(msg, AIMessage):
            groq_messages.append({"role": "assistant", "content": msg.content})
        else:
            groq_messages.append({"role": "user", "content": msg.content})

    stream = await client.chat.completions.create(
        model=SYNTHESIZER_MODEL,
        messages=groq_messages,
        temperature=0.6,
        stream=True
    )
    
    # Create a mock Langchain chunk object so chat.py's parsing stays identical
    class StreamChunk:
        def __init__(self, content):
            self.content = content

    async for chunk in stream:
        if chunk.choices and len(chunk.choices) > 0:
            delta = chunk.choices[0].delta.content
            if delta:
                logger.debug(f"[GROQ_CHUNK]: {delta}")
                yield StreamChunk(delta)
