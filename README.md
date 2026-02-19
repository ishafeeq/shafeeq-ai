# Bol AI — Jeetu Code Assistant

A Hinglish voice assistant (Web Stack) capable of real-time search, RAG, and conversation. Built with **FastAPI**, **LangGraph**, **React**, and **Groq/Sarvam AI**.

## 📂 Project Structure

```
.
├── backend/               # Python FastAPI Backend
│   ├── src/               # Source code
│   │   ├── main.py        # App entry point
│   │   ├── graph.py       # LangGraph AI Agent
│   │   ├── stt_handler.py # Sarvam Speech-to-Text
│   │   ├── tts_handler.py # Sarvam Text-to-Speech
│   │   └── routes/        # API Endpoints
│   ├── uploads/           # User audio uploads
│   └── jeetu.db           # SQLite/Postgres DB
│
├── frontend/              # React + Vite Frontend
│   ├── src/               # UI Components
│   └── dist/              # Production build artifacts
│
├── nginx/                 # Nginx Reverse Proxy Configs
│   ├── nginx.conf         # Dev config (proxies Vite dev server)
│   └── nginx.prod.conf    # Prod config (serves static build + Gunicorn)
│
├── documentation/         # Architecture & Design Docs
│   ├── HLD-Arch.md        # High-Level Design
│   └── LLD.md             # Low-Level Design
│
├── run_stack.sh           # Development startup script
└── run_prod.sh            # Production startup script
```

## 🚀 Getting Started

### Prerequisites
- Python 3.11+
- Node.js 18+
- Docker (for Postgres + pgvector)
- `ffmpeg` (for audio conversion)

### 1. Setup Environment
Create a `.env` file in `backend/.env`:
```ini
GROQ_API_KEY=gsk_...
SARVAM_API_KEY=...
TAVILY_API_KEY=tvly-...
DATABASE_URL=postgresql://user:password@localhost/jeetu
SECRET_KEY=your_secret_key
```

### 2. Run in Development Mode
Starts FastAPI (reload), Vite (HMR), and Nginx (HTTPS proxy).
```bash
./run_stack.sh --init-db  # First run only (inits DB)
./run_stack.sh            # Normal run
```
**Access:** [https://localhost:8443](https://localhost:8443)

### 3. Run in Production Mode
Builds frontend, starts Gunicorn (multi-worker), serving static files via Nginx.
```bash
./run_prod.sh
```

## 🛠 Features
- **Voice-to-Voice:** Sarvam AI STT & TTS pipeline.
- **Smart Agent:** LangGraph pipeline for reasoning (Route, Query, Search, Synthesize).
- **RAG:** Local document search via `pgvector` & `ingest.py`.
- **Hinglish:** Optimized for Indian context.

## 📚 Documentation
See [documentation/HLD-Arch.md](./documentation/HLD-Arch.md) for architecture details.
