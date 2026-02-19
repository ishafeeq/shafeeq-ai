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

# 1. Start Backend (Gunicorn + Uvicorn Workers)
echo "[Backend] Starting Gunicorn with 4 workers..."
cd backend
if [ ! -d ".venv" ] && [ ! -d "venv" ]; then
    echo "Virtual environment not found! Run ./run_stack.sh first to set up dev env."
    exit 1
fi
# Activate venv
if [ -d ".venv" ]; then source .venv/bin/activate; else source venv/bin/activate; fi

# Run Gunicorn: 4 workers, binding to 0.0.0.0:8000
# using src.main:app module path
gunicorn src.main:app \
    --workers 4 \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8000 \
    --timeout 120 \
    --access-logfile - \
    --error-logfile - &
BACKEND_PID=$!
cd ..

# 2. Build Frontend (Vite)
echo "[Frontend] Building production assets..."
cd frontend
npm install  # ensure deps
npm run build
cd ..

# 3. Start Nginx (serving frontend dist/ + proxying backend)
echo "[Nginx] Starting production reverse proxy..."

# We need a production nginx config that points root / to frontend/dist
# instead of proxying to port 5173.
# Let's generate a temporary prod config or use a separate file.
# For now, we'll assume a 'nginx/nginx.prod.conf' exists or create one dynamically.

cat > nginx/nginx.prod.conf <<EOF
worker_processes  1;
events {
    worker_connections  1024;
}
http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile        on;
    keepalive_timeout  65;

    # SSL configuration (same as dev)
    server {
        listen       8443 ssl;
        server_name  localhost;

        ssl_certificate      certs/selfsigned.crt;
        ssl_certificate_key  certs/selfsigned.key;

        # 1. Serve Frontend Build (Static)
        location / {
            root   $(pwd)/frontend/dist;
            index  index.html;
            try_files \$uri \$uri/ /index.html;  # SPA fallback
        }

        # 2. Proxy API to Backend
        location /api/ {
            proxy_pass http://127.0.0.1:8000/;  # Gunicorn port
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
echo "==========================================================="

wait $BACKEND_PID $NGINX_PID
