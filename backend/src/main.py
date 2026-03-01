from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
from dotenv import load_dotenv

load_dotenv()

# Strict Environment Variable Validation
REQUIRED_ENV_VARS = [
    "DATABASE_URL", 
    "SECRET_KEY", 
    "SARVAM_API_KEY", 
    "OLLAMA_BASE_URL", 
    "TAVILY_API_KEY", 
    "GROQ_API_KEY",
    "OTP_AUTH_KEY"
]

for var in REQUIRED_ENV_VARS:
    if not os.environ.get(var):
        raise ValueError(f"CRITICAL: {var} environment variable is missing or empty! Startup aborted.")

from . import models
from .database import engine

# schema generation moved to init_db.py to prevent multi-worker race conditions

from .routes import auth

app = FastAPI(title="Bol-AI SAI Backend")

@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"REQUEST: {request.method} {request.url}")
    try:
        response = await call_next(request)
        print(f"RESPONSE: {response.status_code}")
        return response
    except Exception as e:
        print(f"CRITICAL MIDDLEWARE ERROR: {e}")
        raise e

# CORS
origins = [
    "http://localhost:5173",  # Vite default port
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi.staticfiles import StaticFiles
import os

os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

app.include_router(auth.router)
from .routes import chat
app.include_router(chat.router)

@app.get("/")
async def root():
    return {"message": "Jeetu Code Assistant API is running"}

if __name__ == "__main__":
    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)
