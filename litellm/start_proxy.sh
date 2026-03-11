#!/bin/sh
set -e

echo "🚀 Constructing environment from Docker secrets..."

# Strip newlines/carriage returns from secrets
export GROQ_API_KEY=$(cat /run/secrets/bol_groq_key | tr -d '\n' | tr -d '\r')
export OPENROUTER_API_KEY=$(cat /run/secrets/bol_openrouter_key | tr -d '\n' | tr -d '\r')

# Use local postgres container for LiteLLM to keep Supabase clean
export DATABASE_URL="postgresql://litellm:litellm_pass@litellm-db:5432/litellm_db?schema=litellm_proxy"

echo "⏳ Waiting for LiteLLM Database (litellm-db:5432) to be ready..."
# Use Python to check the connection since psql/nc might be missing in the LiteLLM image
python3 <<EOF
import socket
import time
import os
import sys

db_host = "litellm-db"
db_port = 5432
timeout = 60
start_time = time.time()

print(f"Checking connection to {db_host}:{db_port}...")
while True:
    try:
        with socket.create_connection((db_host, db_port), timeout=2):
            print("✅ Database is reachable!")
            sys.exit(0)
    except (socket.timeout, ConnectionRefusedError, socket.gaierror):
        if time.time() - start_time > timeout:
            print("❌ Timeout waiting for database.")
            sys.exit(1)
        print("Still waiting for database...")
        time.sleep(2)
EOF

if [ $? -ne 0 ]; then
  echo "❌ Failed to connect to database. Exiting."
  exit 1
fi

echo "✅ Database Host: litellm-db (Port 5432)"
echo "✅ Dedicated Schema: litellm_proxy"
echo "✅ Starting LiteLLM Proxy on 0.0.0.0:4000..."

exec litellm --config /app/config.yaml --host 0.0.0.0 --port 4000 --detailed_debug
