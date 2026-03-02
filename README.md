# SAI — AI Research Assistant 🚀
> **An Enterprise-Grade, Hinglish Voice-Native Generative AI Agent**

[![GPT-OSS-20B](https://img.shields.io/badge/LLM-GPT--OSS_20B-green?style=for-the-badge)](https://groq.com/)
[![GPT-OSS-120B](https://img.shields.io/badge/LLM-GPT--OSS_120B-blue?style=for-the-badge)](https://groq.com/)
[![Sarvam AI](https://img.shields.io/badge/Voice-Sarvam_AI-FF9900?style=for-the-badge)](https://sarvam.ai/)
[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![LangGraph](https://img.shields.io/badge/LangGraph-1C1C1C?style=for-the-badge&logo=langchain)](https://python.langchain.com/v0.1/docs/langgraph/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)

---

## 📖 About the Author & Project Intent

I am a **Distributed Cloud Systems Engineer** with **9+ years of experience** at tier-1 tech companies (**Amazon (Hyderabad in last-mile, Canada in Alexa)**, **MakeMyTrip**, and **WalmartLabs**). Throughout my career, I've designed, scaled, and hardened highly concurrent, distributed microservices handling massive throughput. 

**Bol AI** represents my strategic transition into **Principal / Architect AI Engineering**. 

This is not a thin wrapper over an OpenAI API call. This is a fully orchestrated **Multi-Agent Directed Acyclic Graph (DAG)** built upon enterprise architectural principles. I built this to demonstrate how to bridge the gap between "prototype AI" and "production AI" by applying rigorous software engineering guardrails—such as deterministic routing strategies, cost-control context windowing, robust structured logging, and concurrency separation.

## 🎯 What is Bol AI?

**Bol AI** is an intelligent, voice-first AI assistant optimized explicitly for the Indian context (understanding and speaking **Hinglish/Hindi** seamlessly). 
The system operates as an end-to-end voice-in, voice-out assistant capable of:
1. **Real-time Web Searching** for current events.
2. **Retrieval-Augmented Generation (RAG)** over internal project documentation and codebases.
3. **Complex Mathematical and Analytical Reasoning**.

### The Flow at a Glance:
1. **Perceive**: Audio input is captured and parallel-processed for STT translation (English for the LLM) and transliteration (Hinglish/Devanagari for the UI).
2. **Reason**: A LangGraph orchestrator categorizes the intent (`WEB`, `RAG`, `DIRECT`), delegates task execution to sub-agents (e.g., Query Refiner, Context Filter), and synthesizes a final response.
3. **Act**: The response is streamed to Sarvam TTS and rendered gracefully back to the user without UI layout shifts or blocking I/O threads.

---

## 🏛️ Architecture & Implementation Highlights

I consciously chose patterns that maximize modularity, isolation, and horizontal scalability. Detailed architectural breakdowns are available in the `/documentation` directory. 

* **[High-Level Design (HLD)](./documentation/HLD-Arch.md)**: System topology, Nginx routing, and LangGraph DAG Orchestration.
* **[Low-Level Design (LLD)](./documentation/LLD.md)**: Design patterns implemented (Chain of Responsibility, Strategy, Factory, DTOs).
* **[Next Steps & Operational Hardening](./documentation/Next-Steps.md)**: Future concurrency configurations, OpenTelemetry observability, and rate-limiting DDoS strategies.

### Key Architectural Decisions:
- **LangGraph as a Chain of Responsibility**: The 500+ line monolithic execution flow is decoupled strictly into `agents/nodes.py`, `agents/state.py`, and `agents/tools.py`. The graph object is built as a **read-only Stateless Singleton**, making it inherently thread-safe for concurrent user requests.
- **Dual-Model Factory Pipeline**: 
  - *Fast Routing & Filtering*: Utilizes Groq's high-throughput `gpt-oss-20b` for cheap, sub-second deterministic outputs.
  - *Deep Synthesis*: Defers to `gpt-oss-120b` solely for the final user-facing generation. 
- **Non-Blocking Phase Segregation**: To maintain sub-second UI interactivity, the endpoint pipeline is deliberately torn into Phase 1 (Instant Ack & Transcribe) and Phase 2 (Async LLM Reasoning + TTS).
- **RAG via pgvector**: Knowledge embeddings are managed entirely within PostgreSQL utilizing `pgvector`, eliminating the operational overhead of a standalone vector database.

---

## 🛡️ Enterprise Guardrails: Logging & Cost Control

Building AI is easy; building AI that doesn't silently hallucinate away your operational budget is hard.

**1. Token Cost Control & Sliding Windows**
- **Deterministic Bounds**: RAG search nodes explicitly enforce a strict `context_filter` pruning down to 500-1000 tokens before it ever reaches the final expensive Synthesis node.
- **Sliding History Window**: Implemented a proportional truncation algorithm (`_recent_context`) that guarantees the LLM's context window budget is never breached, scaling mathematically based on conversation depth.
- **API Guardrails**: Hard-capped external tool limits (e.g., max 3 Tavily searches per query) and integrated a user `credits_balance` decrement system directly tied to the token volume. 

**2. Observability & Tracking**
- Replaced all raw stdout logic with the standard Python `logging` module.
- Injected `logger` contexts across FastAPI Middleware (`main.py`), DB initializations, STT failure scopes, and Graph Routing Nodes, establishing the bedrock for upcoming Datadog / CloudWatch unified JSON tracing.
- Built graceful fallback degradation: If a non-critical API (like the transliteration endpoint) times out, the system catches the exception, logs a standard `WARNING`, and falls back to translation to guarantee a successful end-user transaction.

---

## 📂 Project Structure

```bash
.
├── backend/               # Python FastAPI Backend
│   ├── src/               # Application Code
│   │   ├── agents/        # Modular LangGraph (nodes, prompts, state, tools)
│   │   ├── main.py        # ASGI Uvicorn Entry & Middleware Logging
│   │   ├── graph.py       # StateGraph Pipeline Orchestration
│   │   ├── stt_handler.py # Facade: Sarvam Speech-to-Text
│   │   ├── tts_handler.py # Facade: Sarvam Text-to-Speech
│   │   └── routes/        # Dependency-injected Controllers
│   └── docker-compose.yml # Container definitions
│
├── frontend/              # React + Vite Frontend (Optimized for zero Layout-shift)
├── nginx/                 # Reverse Proxy Configurations (TLS Termination)
├── documentation/         # HLD, LLD, and Operational Next Steps
└── deploy_prod.sh         # Production Deployment Script
```

---

## 🛠️ Quick Start

### Prerequisites
- Docker engine
- Node.js 18+ (for local frontend dev)

### 1. Environment Configuration
Create a `.env` file inside `./backend`:
```ini
GROQ_API_KEY=gsk_...
SARVAM_API_KEY=...
TAVILY_API_KEY=tvly-...
DATABASE_URL=postgresql://user:password@localhost/jeetu
SECRET_KEY=your_secret_key
# Hardcoded OTP bypass used primarily during the development lifecycle
DEV_HARDCODED_OTP=your_otp_bypass
```

### 2. Launch Local Environment
```bash
# This triggers PostgreSQL+pgvector, FastAPI Gunicorn Workers, and Nginx. 
# Rebuilds safely prioritizing DOCKER_BUILDKIT=0 compatibility overrides.
./deploy_docker.sh
```

---

## 🚀 Forward Roadmap (Principal Horizon)

As documented in [`Next-Steps.md`](./documentation/Next-Steps.md), transitioning this from a robust portfolio to a globally scalable SaaS entails:
- **True Async Telemetry**: Binding `httpx` async clients inside the STT/TTS network I/O to unblock Uvicorn event loops, heavily multiplying vertical compute throughput.
- **OpenTelemetry APM**: Integrating Grafana/OpenTelemetry to surface exact LangGraph stage latencies, pinpointing LLM generation lag in nanoseconds.
- **Aggressive Rate Limiting**: Injecting `slowapi` on endpoints coupled with Nginx `limit_req_zone` memory banks to mitigate DDoS and localized API key abuse vectors. 

---
_Bol AI is actively maintained as a flagship demonstration of full-stack AI Engineering best practices. For architectural inquiries or discussions regarding Principal opportunities, please review the `/documentation` specs or explore the repository commits._
