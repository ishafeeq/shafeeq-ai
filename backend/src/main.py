from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn
import os
import logging

logger = logging.getLogger(__name__)

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
        logger.error(f"CRITICAL: {var} environment variable is missing or empty! Startup aborted.")
        raise ValueError(f"CRITICAL: {var} environment variable is missing or empty! Startup aborted.")

from . import models
from .database import engine

# schema generation moved to init_db.py to prevent multi-worker race conditions

from .routes import auth

app = FastAPI(title="Bol-AI SAI Backend")

@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"REQUEST: {request.method} {request.url}")
    try:
        response = await call_next(request)
        logger.info(f"RESPONSE: {response.status_code}")
        return response
    except Exception as e:
        logger.exception(f"CRITICAL MIDDLEWARE ERROR: {e}")
        return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})

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
