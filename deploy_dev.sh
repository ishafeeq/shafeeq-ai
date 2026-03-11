#!/bin/bash

# Enable job control
set -m

# Function to kill processes on specific ports
kill_port() {
    PORT=$1
    echo "Checking port $PORT..."
    # lsof might not be available or require sudo sometimes, but on mac standard it should work for user processes
    # Try different methods
    PID=$(lsof -ti :$PORT 2>/dev/null)
    if [ -n "$PID" ]; then
        echo "Killing existing process $PID on port $PORT..."
        kill -9 $PID 2>/dev/null
    fi
}

# Function to handle cleanup on exit
cleanup() {
    echo ""
    echo "Stopping all services..."
    
    # Kill the background jobs started by this script
    if [ -n "$BACKEND_PID" ]; then kill $BACKEND_PID 2>/dev/null; fi
    if [ -n "$FRONTEND_PID" ]; then kill $FRONTEND_PID 2>/dev/null; fi
    if [ -n "$NGINX_PID" ]; then kill $NGINX_PID 2>/dev/null; fi
    
    # Also try to kill purely by port if PIDs failed
    kill_port 8000
    kill_port 5173
    kill_port 8080
    kill_port 8443
    
    exit
}

# Trap SIGINT (Ctrl+C) and call cleanup
trap cleanup SIGINT EXIT

echo "Starting Jeetu Code Assistant Stack..."

# Pre-flight cleanup
kill_port 8000
kill_port 5173
kill_port 8080
kill_port 8443

# Check/Start Docker Postgres
if command -v docker &> /dev/null; then
    # Check if Docker daemon is running
    if ! docker info > /dev/null 2>&1; then
        echo "Error: Docker daemon is not running. Please start Docker (or Colima) and try again."
        exit 1
    fi

    if ! docker ps | grep -q "jeetu-postgres"; then
        echo "Starting Postgres container..."
        docker start jeetu-postgres 2>/dev/null || \
        docker run --name jeetu-postgres -e POSTGRES_USER=user -e POSTGRES_PASSWORD=password -e POSTGRES_DB=jeetu -p 5433:5432 -d pgvector/pgvector:pg16
        
        echo "Waiting for Postgres to be ready..."
        sleep 4
        # Enable pgvector extension
        docker exec jeetu-postgres psql -U user -d jeetu -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true
    else
        echo "Postgres container is running."
        # Ensure extension is enabled (idempotent)
        docker exec jeetu-postgres psql -U user -d jeetu -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true
    fi
fi

# Check for --init-db flag
if [[ "$1" == "--init-db" ]]; then
    echo "Initializing Database..."
    cd backend
    
    # Try uv first, if it fails, try manual venv
    if command -v uv &> /dev/null && uv run python -m src.init_db; then
        echo "Database initialized via uv."
    elif [ -d "venv" ]; then
        echo "uv failed or not found. Trying manual venv..."
        source venv/bin/activate
        python3 -m src.init_db
    else
        echo "Fall back to system python..."
        python3 -m src.init_db
    fi
    
    if [ $? -ne 0 ]; then
        echo "Error: Database initialization failed!"
        exit 1
    fi
    
    cd ..
    echo "Database initialized."
fi

# 1. Start Backend (FastAPI)
echo "[Backend] Starting on port 8000..."
cd backend
if command -v uv &> /dev/null; then
    # Ensure dependencies are installed
    if [ -f "pyproject.toml" ]; then
        echo "[Backend] Syncing dependencies..."
        uv sync
    fi
    uv run uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload &
else
    # Fallback to pip
    if [ -f "requirements.txt" ]; then
         pip install -r requirements.txt
    fi
    # If pyproject.toml exists but no uv, try installing deps manually? 
    # For now assume user has env setup or uv.
    python3 -m uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload &
fi
BACKEND_PID=$!
cd ..

# Check backend
sleep 2
if ! ps -p $BACKEND_PID > /dev/null; then
    echo "[Backend] Failed to start!"
    cleanup
fi

# 2. Start Frontend (Vite)
echo "[Frontend] Starting on port 5173..."
if [ -d "frontend" ]; then
    cd frontend
    if [ ! -d "node_modules" ] && [ -f "package.json" ]; then
        echo "[Frontend] Installing dependencies..."
        npm install
    fi
    
    if [ -f "package.json" ]; then
        npm run dev -- --host &
        FRONTEND_PID=$!
    else
        echo "[Frontend] Warning: No package.json found. Skipping."
    fi
    cd ..
else
    echo "[Frontend] Warning: 'frontend' directory not found."
fi

# Check frontend
sleep 2
if [ -n "$FRONTEND_PID" ] && ! ps -p $FRONTEND_PID > /dev/null; then
    echo "[Frontend] Failed to start!"
    cleanup
fi

# 3. Start Nginx
echo "[Nginx] Starting on port 8080..."
CONFIG_PATH="$(pwd)/nginx/nginx.conf"

if command -v nginx &> /dev/null; then
    # Ensure logs directory exists if needed
    nginx -c "$CONFIG_PATH" -g "daemon off;" &
    NGINX_PID=$!
else
    echo "[Nginx] Error: 'nginx' command not found."
    cleanup
fi

# Check nginx
sleep 1
if ! ps -p $NGINX_PID > /dev/null; then
    echo "[Nginx] Failed to start! Check nginx.conf or permissions."
    cleanup
fi

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "unknown")

echo ""
echo "==========================================================="
echo "   Stack is running!"
echo "   > Local:   https://localhost:8443"
echo "   > Network: https://${LAN_IP}:8443  ← use this on mobile"
echo "   NOTE: Accept the self-signed cert warning in your browser"
echo "==========================================================="
echo ""
echo "Press Ctrl+C to stop all services."

# Wait for any process to exit
wait $BACKEND_PID $FRONTEND_PID $NGINX_PID
