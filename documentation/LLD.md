# Low-Level Design (LLD) — Bol AI Voice Assistant

> **App:** `jeetu-code-assistant` | **Last Updated:** February 2026

---

## 1. Overview

This document describes the code-level design patterns, conventions, and structural decisions used in the backend of Bol AI. The backend is written in Python using FastAPI and LangGraph.

---

## 2. Design Patterns Used

### 2.1 Chain of Responsibility (LangGraph DAG)

**Where:** `graph.py`

The LangGraph `StateGraph` is a concrete implementation of the **Chain of Responsibility** pattern. Each node in the graph (`intent_router` → `query_refiner` → `web_search/rag_search` → `context_filter` → `research_synthesize`) handles one specific responsibility and passes enriched state to the next node.

```python
# Each node takes shared state and returns a partial update
def node_intent_router(state: BolState) -> dict:
    ...
    return {"intent": intent, "reasoning_level": reasoning_level}

def node_query_refiner(state: BolState) -> dict:
    ...
    return {"search_queries": queries}
```

- Each node is **single-responsibility**: it reads from state fields it needs, and writes only the fields it owns.
- Routing between nodes is done by **conditional edges** (guard functions), keeping the pipeline logic out of the node functions themselves.

```python
def after_intent_router(state: BolState) -> str:
    return "query_refiner" if state.get("intent") in ("WEB", "RAG") else "research_synthesize"
```

---

### 2.2 Strategy Pattern (Intent-based Routing)

**Where:** `graph.py` — `after_query_refiner`

The correct "search strategy" (web vs. vector) is selected at runtime based on the `intent` field in state:

```python
def after_query_refiner(state: BolState) -> str:
    return "web_search" if state.get("intent") == "WEB" else "rag_search"
```

Both `node_web_search` and `node_rag_search` have the same signature `(state) -> dict` and return the same output key (`raw_context`), making them interchangeable strategies behind a uniform interface.

---

### 2.3 Factory Pattern (LLM Client Factory)

**Where:** `graph.py` — `_llm()`

A private factory function creates `ChatGroq` instances on demand with parameterized model and temperature, decoupling the model configuration from every node that uses it:

```python
def _llm(model: str, temperature: float = 0) -> ChatGroq:
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set.")
    return ChatGroq(api_key=GROQ_API_KEY, model=model, temperature=temperature)
```

This means all nodes call `_llm(GUARDRAIL_MODEL)` or `_llm(SYNTHESIZER_MODEL, temperature=0.6)` rather than constructing clients directly — making model swapping trivial.

---

### 2.4 Template Method Pattern (System Prompts as Templates)

**Where:** `graph.py` — `_SYNTHESIZE_SYSTEM`

The synthesizer system prompt uses Python string formatting as a **template method** — the skeleton is defined once, and variable parts (`{name}`, `{current_date}`) are injected at call time:

```python
_SYNTHESIZE_SYSTEM = """\
You are Bol AI, a smart ... assistant talking to {name}.
Current date: {current_date}.
...
"""

system_content = _SYNTHESIZE_SYSTEM.format(name=name, current_date=CURRENT_DATE)
```

This keeps the prompt logic centralised and testable, rather than being embedded inside node functions.

---

### 2.5 Repository Pattern (Database Access via SQLAlchemy)

**Where:** `database.py`, `models.py`, `routes/auth.py`, `routes/chat.py`

The database session is managed via SQLAlchemy's `SessionLocal` and injected into every route using FastAPI's dependency injection (`Depends`):

```python
# database.py — session factory
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# In routes — session injected via DI
def get_conversations(db: Session = Depends(database.get_db), ...):
    return db.query(models.Conversation).filter(...).all()
```

Models (`models.py`) act as the **repository/entity layer**, and routes act as **service/controller layer** — a thin separation of concerns.

---

### 2.6 Dependency Injection (FastAPI `Depends`)

**Where:** All route handlers in `routes/auth.py` and `routes/chat.py`

FastAPI's built-in `Depends()` is used for injecting:
- `database.get_db` → DB session per request
- `auth.get_current_user` → authenticated user object decoded from JWT

```python
@router.post("/chat/text", response_model=schemas.Message)
def chat_text(
    request: schemas.ChatRequest,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    ...
```

This follows the **Inversion of Control** principle — routes declare what they need, not how to obtain it.

---

### 2.7 Facade Pattern (STT Handler)

**Where:** `stt_handler.py`

`stt_handler.transcribe()` hides the complexity of:
- Audio format conversion (`ffmpeg` subprocess for `.webm` → `.wav`)
- Two separate API calls to Sarvam (translate + translit modes)
- Error handling and fallback logic

Behind a single, clean function signature:

```python
def transcribe(audio_path: str, language_code: str = "hi-IN") -> dict:
    # Returns: {"translated_text": str, "translit_text": str}
```

The caller (route handler) doesn't need to know about Sarvam's API contract or format conversion.

---

### 2.8 Null Object / Graceful Degradation (STT Fallback)

**Where:** `stt_handler.py`

If the `translit` mode call fails (network error, unsupported language, etc.), the system gracefully falls back to the translated English text rather than crashing:

```python
except Exception as e:
    logger.warning(f"[STT] translit mode failed (non-critical): {e}")
    result["translit_text"] = result["translated_text"]  # fallback
```

Similarly in `graph.py`, every node wraps its LLM call in a `try/except` with a safe fallback:

```python
except Exception as e:
    logger.error(f"[IntentRouter] Error: {e}")
    intent, reasoning_level = "DIRECT", "med"  # safe default
```

---

### 2.9 Value Object / TypedDict State (Immutable-style Pipeline State)

**Where:** `graph.py` — `BolState`

The shared pipeline state is defined as a `TypedDict` — a typed, structured dictionary:

```python
class BolState(TypedDict):
    messages:        Annotated[List[BaseMessage], add_messages]
    user_name:       str
    user_mobile:     str
    intent:          str           # WEB | RAG | DIRECT
    reasoning_level: str           # low | med | high
    translit_text:   str
    search_queries:  List[str]
    raw_context:     str
    tool_context:    str
```

Each node returns a **partial dict** that merges into the state, rather than mutating a shared object directly. `add_messages` is a special reducer for the `messages` field that appends — never overwrites.

---

### 2.10 Schema Layer / DTO Pattern (Pydantic Schemas)

**Where:** `schemas.py`

Pydantic models act as **Data Transfer Objects (DTOs)** separating network-layer data shapes from ORM models:

- `schemas.ChatRequest` → what the client POSTs
- `schemas.Message` → what the API returns (may omit internal fields)
- `schemas.Token` → JWT token response
- `schemas.Conversation`, `schemas.User` → public-facing projections of DB models

This prevents accidentally exposing internal fields (like raw OTPs or passwords) through the API.

---

### 2.11 Singleton (Compiled Graph)

**Where:** `graph.py` — module-level `_graph`

The LangGraph compiled object is built **once at module import time** and reused for every request:

```python
_graph = _build_graph()  # module-level — compiled once

def run_graph(...) -> str:
    result = _graph.invoke(initial_state, config=config)
    ...
```

This avoids the overhead of rebuilding the graph on every request.

---

### 2.12 Context Windowing / Sliding Window Pattern

**Where:** `graph.py` — `_recent_context()`

The helper implements a **sliding window** over conversation history to stay within the LLM's context budget:

1. Takes the last N turns of messages
2. Calculates total character count
3. If over budget, applies **proportional truncation** — each message gets a fair share of the remaining budget (minimum 200 chars)

```python
per_msg_budget = max(200, budget // len(lines))
```

This prevents context overflow errors while preserving as much relevant history as possible.

---

## 3. File-Level Responsibilities

| File | Pattern(s) | Responsibility |
|---|---|---|
| `main.py` | Application Bootstrap | FastAPI app init, middleware, router registration |
| `graph.py` | Chain of Responsibility, Factory, Strategy, Singleton | LangGraph AI pipeline definition and execution |
| `stt_handler.py` | Facade, Null Object | Sarvam STT wrapping + format conversion |
| `tts_handler.py` | Facade | Sarvam TTS streaming + playback |
| `auth.py` | Utility / Security Module | JWT creation/validation, OTP utilities |
| `database.py` | Repository (session factory) | DB engine and session lifecycle |
| `models.py` | Entity / ORM Models | SQLAlchemy table definitions |
| `schemas.py` | DTO / Schema Layer | Pydantic request/response shapes |
| `ingest.py` | Script / CLI | One-shot RAG data ingestion tool |
| `routes/auth.py` | Controller | Auth endpoint handlers |
| `routes/chat.py` | Controller | Chat, transcription, history endpoint handlers |

---

## 4. Data Flow Summary

```
HTTP Request
     │
     ▼
FastAPI Router
     │
     ├── Pydantic schema validation (DTO in)
     ├── Depends: DB session injected
     ├── Depends: JWT → current_user injected
     │
     ▼
Route Handler (Controller)
     │
     ├── DB queries via SQLAlchemy ORM (Repository)
     ├── stt_handler.transcribe() (Facade)
     ├── graph.run_graph() (Chain of Responsibility)
     └── tts_handler.generate_audio() (Facade)
     │
     ▼
Pydantic schema serialization (DTO out)
     │
     ▼
HTTP Response
```
