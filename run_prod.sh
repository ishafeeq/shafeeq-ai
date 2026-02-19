#!/bin/bash

# Enable job control
set -m

# Function to kill existing processes on ports
kill_port() {
    PORT=$1
    PID=$(lsof -ti :$PORT)
    if [ -n "$PID" ]; then
        echo "Killing process $PID on port $PORT..."
        kill -9 $PID 2>/dev/null
    fi
}

# Function to handle cleanup on exit
cleanup() {
    echo ""
    echo "Stopping all services..."
    if [ -n "$BACKEND_PID" ]; then kill $BACKEND_PID 2>/dev/null; fi
    if [ -n "$NGINX_PID" ]; then kill $NGINX_PID 2>/dev/null; fi
    kill_port 8000
    kill_port 8080
    kill_port 8443
    exit
}

trap cleanup SIGINT EXIT

echo "Starting Bol AI in PRODUCTION mode..."

# 0. Pre-flight Checks -> SSL Certs
echo "[Setup] Checking SSL certificates..."
mkdir -p nginx/certs
if [ ! -f "nginx/certs/selfsigned.crt" ] || [ ! -f "nginx/certs/selfsigned.key" ]; then
    echo "Generating self-signed SSL certificate..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout nginx/certs/selfsigned.key \
        -out nginx/certs/selfsigned.crt \
        -subj "/C=IN/ST=Telangana/L=Hyderabad/O=Jeetu/OU=Dev/CN=localhost" 2>/dev/null
    echo "Certificate generated."
else
    echo "SSL certificates found."
fi

# 1. Start Backend (Gunicorn + Uvicorn Workers)
echo "[Backend] Starting Gunicorn with 4 workers..."
cd backend

# Ensure gunicorn is installed
if command -v uv &> /dev/null; then
    echo "Using uv to run backend..."
    if ! uv pip show gunicorn &>/dev/null; then
        echo "Installing gunicorn via uv..."
        uv add gunicorn
    fi
    # Run via uv
    uv run gunicorn src.main:app \
        --workers 4 \
        --worker-class uvicorn.workers.UvicornWorker \
        --bind 0.0.0.0:8000 \
        --timeout 120 \
        --access-logfile - \
        --error-logfile - &
    BACKEND_PID=$!
else
    # Fallback to pip/venv
    if [ ! -d ".venv" ] && [ ! -d "venv" ]; then
        echo "Virtual environment not found! Run ./run_stack.sh first to set up dev env."
        exit 1
    fi
    # Activate venv
    if [ -d ".venv" ]; then source .venv/bin/activate; else source venv/bin/activate; fi
    
    if ! pip show gunicorn &>/dev/null; then
        echo "Installing gunicorn via pip..."
        pip install gunicorn
    fi
    
    gunicorn src.main:app \
        --workers 4 \
        --worker-class uvicorn.workers.UvicornWorker \
        --bind 0.0.0.0:8000 \
        --timeout 120 \
        --access-logfile - \
        --error-logfile - &
    BACKEND_PID=$!
fi
cd ..

# 2. Build Frontend (Vite)
echo "[Setup] Preparing uploads directory..."
mkdir -p backend/uploads
chmod 777 backend/uploads

echo "[Frontend] Building production assets..."
cd frontend
if [ ! -d "node_modules" ]; then
    npm install
fi
npm run build
cd ..

# 3. Start Nginx (serving frontend dist/ + proxying backend)
echo "[Nginx] Starting production reverse proxy..."

# Check for ffmpeg (Required for audio processing)
if ! command -v ffmpeg &> /dev/null; then
    echo "Warning: ffmpeg is not installed. Audio uploads (e.g. webm) may fail if Sarvam AI doesn't support the format directly."
    echo "To fix: brew install ffmpeg"
else
    echo "ffmpeg found."
fi

# Generate prod config dynamically
mkdir -p nginx
mkdir -p nginx/temp
chmod 777 nginx/temp

cat > nginx/nginx.prod.conf <<EOF
worker_processes  1;
events {
    worker_connections  1024;
}
http {
    include       mime.types;
    default_type  application/octet-stream;
    
    # Increase upload size limit for audio files
    client_max_body_size 50M;
    # Explicit temp path to avoid permission issues
    client_body_temp_path $(pwd)/nginx/temp;
    
    sendfile        on;
    keepalive_timeout  65;

    # SSL configuration (same as dev)
    server {
        listen       8443 ssl;
        server_name  localhost;

        ssl_certificate      $(pwd)/nginx/certs/selfsigned.crt;
        ssl_certificate_key  $(pwd)/nginx/certs/selfsigned.key;

        # 1. Serve Frontend Build (Static)
        location / {
            root   $(pwd)/frontend/dist;
            index  index.html;
            try_files \$uri \$uri/ /index.html;  # SPA fallback
        }

        # 2. Proxy API to Backend
        location /api/ {
            proxy_pass http://127.0.0.1:8000/;  # Gunicorn port (trailing slash needed to strip /api prefix?)
            # Wait, FastAPI strips /api automatically? No, in run_stack.sh /api mounts to /
            # If backend is on 8000/, then http://127.0.0.1:8000/users/me works.
            # If request is /api/users/me, proxy_pass http://127.0.0.1:8000/ will map to /users/me nicely.
            
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host \$host;
            proxy_cache_bypass \$http_upgrade;
            
            # Helper headers
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;

            # Long timeout for AI generation
            proxy_read_timeout 300s;
        }

        # 3. Serve Uploads (Directly from disk)
        location /uploads/ {
            alias $(pwd)/backend/uploads/;
            autoindex off;
        }
    }

    # Redirect HTTP to HTTPS
    server {
        listen 8080;
        server_name localhost;
        return 301 https://\$host:8443\$request_uri;
    }
}
EOF

nginx -c "$(pwd)/nginx/nginx.prod.conf" -g "daemon off;" &
NGINX_PID=$!

echo ""
echo "==========================================================="
echo "   PRODUCTION Stack is running!"
echo "   > URL: https://localhost:8443"
echo "   Backend running on Gunicorn (4 workers)"
echo "   Frontend serving static files from dist/"
echo "   PID: Backend=$BACKEND_PID Nginx=$NGINX_PID"
echo "==========================================================="

wait $BACKEND_PID $NGINX_PID
