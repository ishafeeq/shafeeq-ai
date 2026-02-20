FROM python:3.9-slim

WORKDIR /app

# Install system dependencies (FFmpeg for audio processing)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libportaudio2 \
    libsndfile1 \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast package management
RUN pip install uv

# Copy the entire backend directory
COPY . .

# Install dependencies into system Python environment using uv
RUN uv pip install --system -e .

# Ensure uploads directory exists
RUN mkdir -p uploads && chmod 777 uploads

EXPOSE 8000

# Default command (can be overridden by docker-compose)
CMD ["gunicorn", "src.main:app", "--workers", "4", "--worker-class", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000", "--timeout", "300"]
