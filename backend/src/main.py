# --- ABSOLUTE TOP: EMERGENCY OTEL SDK STABILIZATION ---
# This MUST be before any other imports to prevent "NoneType" crashes and log pollution.
try:
    import opentelemetry.exporter.otlp.proto.common._internal as otlp_internal
    _orig_encode_value = otlp_internal._encode_value
    def _patched_encode_value(value, allow_null=False):
        if value is None:
            return _orig_encode_value("", allow_null=allow_null)
        if not isinstance(value, (int, str, float, bool)):
            return _orig_encode_value(str(value), allow_null=allow_null)
        return _orig_encode_value(value, allow_null=allow_null)
    otlp_internal._encode_value = _patched_encode_value
    
    import os
    import logging
    # Silence the aggressive NoneType validation warnings in the console
    logging.getLogger("opentelemetry.attributes").setLevel(logging.ERROR)
    # Silence Console/Logging fallbacks
    os.environ["OTEL_LOGS_EXPORTER"] = "none"
    os.environ["OTEL_TRACES_EXPORTER"] = "otlp"
    os.environ["OTEL_METRICS_EXPORTER"] = "otlp"
except Exception:
    pass
# ------------------------------------------------------

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn
import logging
import openlit
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

logger = logging.getLogger(__name__)


# Strict Environment Variable Validation
REQUIRED_ENV_VARS = [
    "DATABASE_URL", 
    "SECRET_KEY", 
    "SARVAM_API_KEY", 
    "OLLAMA_BASE_URL", 
    "TAVILY_API_KEY", 
    "GROQ_API_KEY",
    "OTP_AUTH_KEY",
    "LITELLM_MASTER_KEY"
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

# Initialize OpenLIT telemetry AFTER the app and routes are created,
# so that FastAPI routes are correctly instrumented with their full paths.
try:
    def server_request_hook(span, scope):
        if span and span.is_recording():
            pass # We let the default ASGI instrumentor handle this

    def client_response_hook(span, scope, message):
        if span and span.is_recording():
            if message and message.get("type") == "http.response.start":
                status = message.get("status")
                if status is not None:
                    span.set_attribute("http.status_code", status)
                    from opentelemetry.trace.status import Status, StatusCode
                    if status >= 400:
                        span.set_status(Status(StatusCode.ERROR))
                    else:
                        span.set_status(Status(StatusCode.OK))

    FastAPIInstrumentor.instrument_app(
        app, 
        client_response_hook=client_response_hook
    )
    openlit.init(
        environment="development",
        application_name="bol-ai-backend",
        otlp_endpoint="http://jaeger:4318"
    )
except Exception as e:
    logger.error(f"Failed to initialize OpenLIT: {e}")

if __name__ == "__main__":
    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)
