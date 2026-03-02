# Next Steps — Operational Hardening Guide

> **App:** `jeetu-code-assistant` | **Last Updated:** February 2026

This document analyses the current production readiness of the backend and prescribes concrete next steps across: concurrency, multi-core utilisation, structured logging, performance testing, observability/monitoring, and API security (DDoS/rate limiting).

---

## 1. Is This a Single-Threaded Application?

### Current Reality

The backend uses **Uvicorn** (ASGI) with **FastAPI**, which is **asynchronous by default**. However, the actual I/O characteristics are mixed:

| Endpoint | Type | Behaviour |
|---|---|---|
| `GET /conversations` | Sync (`def`) | Runs in thread pool executor (FastAPI auto-wraps sync routes) |
| `POST /chat/res-text` | Sync (`def`) | Runs in thread pool executor |
| `POST /chat/audio` | Async (`async def`) | Runs on event loop, but STT/TTS calls are blocking `requests` |
| `POST /chat/transcribe` | Async (`async def`) | Same — blocking SDK calls inside async function |

> [!WARNING]
> `stt_handler.transcribe()` and `tts_handler.generate_audio()` use **synchronous `requests`** and **blocking file I/O** inside `async def` route handlers. This will **block the entire event loop** while waiting for Sarvam API responses (can be 2–10 seconds per call), effectively making the server single-threaded during those calls.

**What happens with multiple concurrent users?**
- With **1 Uvicorn worker**: requests queue up behind each slow Sarvam call. User B waits while User A's STT is in progress.
- The `_graph` singleton is **stateless per invocation** (state is created fresh in `run_graph()` per call) — so **LangGraph itself is concurrency-safe**. Multiple calls to `run_graph()` do not interfere.
- The **SQLAlchemy session** is per-request (via `Depends(get_db)`) — also safe.

---

## 2. Multi-Core Utilisation

### Current State

Uvicorn by default starts **1 worker process** — this uses only **1 CPU core**.

### Fix: Uvicorn with Multiple Workers

```bash
# Use Gunicorn as a process manager (production standard)
gunicorn main:app \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --timeout 300
```

- `--workers 4` → 4 processes, each on its own core (set to `2 × CPU_COUNT + 1`)
- `UvicornWorker` → each process still runs async Uvicorn inside
- `--timeout 300` → needed for long Groq + Sarvam calls

### Cloud Instance Sizing Recommendation

| Cores | Workers | Concurrent requests |
|---|---|---|
| 2 vCPU | 4 workers | ~4 simultaneous LLM calls |
| 4 vCPU | 9 workers | ~9 simultaneous LLM calls |
| 8 vCPU | 17 workers | ~17 simultaneous LLM calls |

> [!IMPORTANT]
> Most latency is **externally bound** (Groq: ~2–5s, Sarvam: ~3–8s), not CPU-bound. Multiple workers allow parallel requests to different external APIs concurrently.

### Fix: Async HTTP for STT/TTS

Replace blocking `requests` with `httpx` async client to allow true concurrency on a single worker:

```python
# tts_handler.py — replace:
import httpx

async def generate_audio(text: str, output_path: str) -> str:
    async with httpx.AsyncClient(timeout=60) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as response:
            response.raise_for_status()
            with open(output_path, "wb") as f:
                async for chunk in response.aiter_bytes(8192):
                    f.write(chunk)
```

### Shared State Concern: `_graph` object

The compiled LangGraph `_graph` object is a **module-level singleton**. Because each `run_graph()` call:
- Creates its own `initial_state` dict (no shared mutable state)
- Uses `thread_id` in config (`user_{id}_conv_{id}`) for LangGraph checkpointing

**→ It is safe for concurrent use across multiple users.** Each invocation is fully isolated.

---

## 3. Structured Logging for Failure Tracking

### Current State

The app uses Python's `logging` module with basic `basicConfig`. Logs go to stdout/stderr only, with no structured format, no correlation IDs, and no log levels per module.

### Recommended: Structured JSON Logging

Install `structlog` or configure `logging` with JSON formatter:

```python
# main.py — structured logging setup
import logging
import json

class JSONFormatter(logging.Formatter):
    def format(self, record):
        log = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", None),
        }
        if record.exc_info:
            log["exception"] = self.formatException(record.exc_info)
        return json.dumps(log)

handler = logging.StreamHandler()
handler.setFormatter(JSONFormatter())
logging.root.addHandler(handler)
```

### Add Request Correlation IDs

```python
# middleware in main.py
import uuid
from contextvars import ContextVar

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

@app.middleware("http")
async def add_request_id(request: Request, call_next):
    req_id = str(uuid.uuid4())[:8]
    request_id_var.set(req_id)
    request.state.request_id = req_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = req_id
    return response
```

### Log Levels by Component

| Component | Recommended Level |
|---|---|
| Auth failures | `WARNING` |
| LangGraph node entry/exit | `INFO` |
| External API errors (Groq, Sarvam, Tavily) | `ERROR` |
| STT translit fallback | `WARNING` |
| DB query errors | `ERROR` |
| Request/response | `INFO` |

### Centralised Log Shipping

In production, ship logs to a centralised platform:
- **AWS CloudWatch** / **GCP Cloud Logging** / **Azure Monitor** (if cloud-native)
- **Datadog Logs** or **Grafana Loki** (if self-managed)
- Use log rotation: `logging.handlers.RotatingFileHandler` for file-based backup

---

## 4. Performance Testing

### Current State

No performance tests exist. AI endpoints have high latency (3–15s per request) due to external LLM/STT/TTS calls.

### Recommended Test Suite

#### 4.1 Load Testing with `locust`

```python
# locustfile.py
from locust import HttpUser, task, between

class BolAIUser(HttpUser):
    wait_time = between(2, 5)
    token = None

    def on_start(self):
        resp = self.client.post("/verify-otp", json={
            "mobile_number": "+919999999999", "otp": "123456"
        })
        self.token = resp.json()["access_token"]

    @task(3)
    def chat_text(self):
        self.client.post("/chat/res-text",
            json={"conversation_id": 1, "content": "What is today's date?", "generate_audio": False},
            headers={"Authorization": f"Bearer {self.token}"}
        )

    @task(1)
    def get_conversations(self):
        self.client.get("/conversations",
            headers={"Authorization": f"Bearer {self.token}"}
        )
```

```bash
locust -f locustfile.py --host https://localhost:8443 --users 20 --spawn-rate 2
```

#### 4.2 Baseline Benchmarks to Establish

| Metric | Target |
|---|---|
| `POST /chat/res-text` (DIRECT intent) | p95 < 5s |
| `POST /chat/res-text` (WEB intent) | p95 < 12s |
| `POST /chat/audio` (full round-trip) | p95 < 20s |
| `GET /conversations` | p99 < 200ms |
| Error rate under 20 concurrent users | < 1% |

#### 4.3 Profiling Bottlenecks

```bash
# Profile a single request with py-spy
pip install py-spy
py-spy record -o profile.svg -- python -m uvicorn main:app
```

---

## 5. Monitoring for Performance and Cost

### 5.1 Application Performance Monitoring (APM)

Recommended: **OpenTelemetry** (vendor-neutral, works with Datadog, Grafana, Jaeger, etc.)

```bash
pip install opentelemetry-sdk opentelemetry-instrumentation-fastapi
```

```python
# main.py
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

FastAPIInstrumentor.instrument_app(app)
```

Key spans to trace:
- Each LangGraph node execution time
- Sarvam STT call duration (per mode)
- Sarvam TTS call duration
- Tavily search latency
- pgvector query latency
- DB query latency

### 5.2 Key Metrics Dashboard (Grafana / Datadog)

| Metric | Alert Threshold |
|---|---|
| Request rate (req/min) per endpoint | — |
| p95 latency per endpoint | > 15s → alert |
| Error rate (5xx) | > 2% → alert |
| LangGraph node latency (per node) | intent_router > 3s → alert |
| Sarvam STT call latency | > 10s → alert |
| Active DB connections | > 80% of pool |
| PostgreSQL query time | p99 > 500ms → alert |

### 5.3 Cost Monitoring

| API | Metric to Track | Tooling |
|---|---|---|
| **Groq** | Tokens per request (input + output), requests/day | Groq dashboard + custom logging |
| **Sarvam** | Audio seconds processed (STT + TTS) per user | Log `audio_duration` field per request |
| **Tavily** | Searches per day | Tavily dashboard + custom counter |

**Cost control suggestions:**
- Log `token_count` from Groq responses: `response.usage.total_tokens`
- Track per-user `credits_balance` (already in DB) and deduct per request
- Set **hard limits**: max 3 Tavily searches per `/chat/res-text` request (already implemented)
- Alert when daily Groq token spend exceeds threshold

---

### 5.4 Advanced LLM Observability & Gatekeeping
To transition from basic APM to specialized AI telemetry, introduce an LLM Gateway/Observability layer:

**Recommended Providers:** **Helicone** or **Portkey**

| Feature | Implementation Benefit |
|---|---|
| **Centralized Telemetry** | Log full trace data of tool calling, exact prompts sent, and agent behavioral flow over time. |
| **Cost Control** | Enforce precise budgeting, cache frequent queries (e.g. "who are you?"), and route fallback models automatically. |
| **Guardrails & Security** | Detect PII leakage, block prompt injection attacks, and apply content moderation gates before generating a response. |

```python
# Implementation Example (Portkey)
from portkey_ai import Portkey

client = Portkey(
    api_key="PORTKEY_API_KEY",
    virtual_key="GROQ_VIRTUAL_KEY", 
    trace_id=request.headers.get("X-Request-ID")
)
```

### 5.5 LLM Evaluation & Testing (MLOps)
Prevent production regression through deterministic prompt testing and ongoing output evaluation.

| Phase | Tool | Purpose |
|---|---|---|
| **Pre-Production** | **Promptfoo** | Run deterministic test matrices against your `_SYNTHESIZE_SYSTEM` prompt variations before merging. |
| **Post-Production** | **DeepEval** | Continuous evaluation of live outputs over time. |

**Key Evaluation Metrics to Track:**
- **Hallucination Rate**: Measure factual drift from provided context during RAG scenarios.
- **Context Drift**: Track if the response loses context deep into a multi-turn conversation.
- **Answer Relevancy**: Score the precision of the generated Hinglish responses relative to the user's intent.

---

## 6. DDoS and Rate Limiting

### Current State

There is **zero rate limiting** in the codebase. Any caller with a valid JWT can make unlimited requests to all endpoints, including expensive AI endpoints.

### 6.1 Recommended: `slowapi` (FastAPI-native Rate Limiter)

```bash
pip install slowapi
```

```python
# main.py
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

```python
# routes/chat.py — per-endpoint limits
from main import limiter

@router.post("/chat/audio")
@limiter.limit("10/minute")          # 10 audio requests per minute per IP
async def chat_audio(request: Request, ...):
    ...

@router.post("/chat/res-text")
@limiter.limit("30/minute")          # 30 text requests per minute per IP
def chat_text(request: Request, ...):
    ...

@router.post("/send-otp")
@limiter.limit("5/minute")           # prevent OTP flooding / SMS abuse
def send_otp(request: Request, ...):
    ...
```

### 6.2 Per-User (Token-based) Rate Limiting

To limit **per authenticated user** (not just per IP — which can be bypass via proxies):

```python
def get_user_id(request: Request) -> str:
    # Extract user ID from JWT for per-user key
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        return payload.get("sub", get_remote_address(request))
    except Exception:
        return get_remote_address(request)

limiter = Limiter(key_func=get_user_id)
```

### 6.3 Nginx-Level Rate Limiting (DDoS Protection)

Add to `nginx.conf` before proxying to FastAPI:

```nginx
http {
    # Define rate limit zones
    limit_req_zone $binary_remote_addr zone=api_general:10m rate=60r/m;
    limit_req_zone $binary_remote_addr zone=api_audio:10m  rate=10r/m;
    limit_req_zone $binary_remote_addr zone=auth:10m       rate=5r/m;

    server {
        # Auth endpoints — strict
        location ~ ^/api/(send-otp|verify-otp) {
            limit_req zone=auth burst=2 nodelay;
            proxy_pass http://localhost:8000/;
        }

        # Audio endpoint — strict (expensive)
        location /api/chat/audio {
            limit_req zone=api_audio burst=3 nodelay;
            proxy_pass http://localhost:8000/chat/audio;
        }

        # General API
        location /api/ {
            limit_req zone=api_general burst=10 nodelay;
            proxy_pass http://localhost:8000/;
        }
    }
}
```

### 6.4 DDoS Mitigation Strategy

| Layer | Tool | What it protects against |
|---|---|---|
| **CDN / Cloud** | Cloudflare Free / AWS WAF | Volume floods, botnet attacks |
| **Nginx** | `limit_req_zone` | IP-level request flooding |
| **FastAPI** | `slowapi` | Per-IP / per-user endpoint abuse |
| **Application** | JWT auth on all AI routes | Unauthenticated LLM cost abuse |
| **Application** | `credits_balance` model | Per-user soft cost cap |
| **Groq/Tavily** | Dashboard budget limits | Hard spend caps on API keys |

### 6.5 Recommended Rate Limits Table

| Endpoint | Per IP (Nginx) | Per User (slowapi) | Reason |
|---|---|---|---|
| `POST /send-otp` | 5/min | 3/min | Prevent SMS flood abuse |
| `POST /verify-otp` | 10/min | 5/min | Prevent brute-force OTP |
| `POST /chat/audio` | 10/min | 10/min | Most expensive: STT + LLM + TTS |
| `POST /chat/res-text` | 30/min | 30/min | Moderately expensive (LLM only) |
| `POST /chat/transcribe` | 20/min | 20/min | Expensive: 2× Sarvam STT calls |
| `GET /conversations` | 60/min | 60/min | Cheap DB read |
| `POST /conversations` | 10/min | 10/min | Low, to prevent spam |

---

## 7. Summary of Action Items

| Priority | Area | Action |
|---|---|---|
| 🔴 **High** | Concurrency | Replace blocking `requests` in STT/TTS handlers with `httpx` async |
| 🔴 **High** | Security | Add `slowapi` rate limiting on all endpoints, especially `/send-otp` and `/chat/audio` |
| 🔴 **High** | Multi-core | Deploy with Gunicorn + UvicornWorker (`workers = 2 × cores + 1`) |
| 🟡 **Medium** | Logging | Add structured JSON logging + request correlation IDs |
| 🟡 **Medium** | Monitoring | Instrument with OpenTelemetry; set up Grafana dashboard |
| 🟡 **Medium** | Cost | Log Groq token usage per request; deduct from `credits_balance`; set API key spend caps |
| 🟡 **Medium** | Rate Limiting | Add Nginx `limit_req_zone` rules for IP-level DDoS protection |
| 🟢 **Low** | Performance Testing | Set up `locust` and establish p95 baseline latencies |
| 🟢 **Low** | Observability | Integrate Portkey/Helicone for deep tool-calling telemetry and agent tracking. |
| 🟢 **Low** | CI/CD Eval | Integrate Promptfoo pre-prod testing and setup DeepEval for context drift alerts. |
