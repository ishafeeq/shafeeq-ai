#!/bin/bash
# Production Deployment Script for SAI

# Enable strict mode
set -e

# Cleanup function for SSH Tunnels
cleanup_tunnels() {
    if [ -n "${TUNNEL_PID:-}" ]; then
        echo -e "\n🛑 Closing SSH tunnels (PID: $TUNNEL_PID)..."
        kill $TUNNEL_PID 2>/dev/null || true
        unset TUNNEL_PID
    fi
}

# Exit immediately if a command exits with a non-zero status
trap 'echo -e "\n❌ Deployment failed!"; cleanup_tunnels; exit 1' ERR
trap 'cleanup_tunnels' EXIT SIGINT SIGTERM
echo "=========================================================="
echo "🚀 Syncing and Deploying SAI to AWS Cloud 🚀"
echo "=========================================================="

# AWS Connection Details
AWS_KEY="/Users/shafeeq/Documents/01-New-Job/Prep/ai-serv/lul-mul-tul.pem"
AWS_USER="ubuntu"
AWS_HOST="ec2-3-7-70-60.ap-south-1.compute.amazonaws.com"
REMOTE_DIR="~/sai-deployment"
SETUP_SCRIPT_PATH="/Users/shafeeq/Documents/01-New-Job/Prep/ai-serv/setup-script.sh"

# Ensure AWS key exists
if [ ! -f "$AWS_KEY" ]; then
    echo "❌ Error: AWS Key not found at $AWS_KEY"
    exit 1
fi

# Ensure correct permissions on key
chmod 400 "$AWS_KEY"

# 1. Prepare Remote Directory
echo "\n[1/4] Preparing remote deployment directory..."
ssh -i "$AWS_KEY" -o StrictHostKeyChecking=no "${AWS_USER}@${AWS_HOST}" "mkdir -p ${REMOTE_DIR}"

# 2. Sync Codebase using Tar over SSH (More robust than rsync in some environments)
echo "\n[2/4] Synchronizing codebase to AWS EC2 via Tar/SSH..."
tar --exclude='./node_modules' \
    --exclude='./venv' \
    --exclude='./.venv' \
    --exclude='**/.venv' \
    --exclude='./backend/.venv' \
    --exclude='./__pycache__' \
    --exclude='./.git' \
    --exclude './.DS_Store' \
    --exclude './build' \
    --exclude './.env' \
    --exclude './secrets' \
    -czf - . | ssh -i "$AWS_KEY" -o StrictHostKeyChecking=no "${AWS_USER}@${AWS_HOST}" "tar -xzf - -C ${REMOTE_DIR}"

# 3. Execute Cloud Deployment Script
echo "\n[3/4] Executing deployment on AWS Cloud..."
ssh -i "$AWS_KEY" -o StrictHostKeyChecking=no "${AWS_USER}@${AWS_HOST}" "cd ${REMOTE_DIR} && chmod +x deploy_on_cloud.sh && chmod +x setup_cloud_proxy.sh && ./deploy_on_cloud.sh"

# 4. Establish SSH Tunnels for Observability & LiteLLM Gateway
echo "\n[4/4] Establishing secure SSH tunnels for Grafana, Prometheus, Jaeger and LiteLLM..."
# Kill any existing local tunnels on these ports (4000, 9100, 9101)
lsof -ti:4000,9100,9101 | xargs kill -9 2>/dev/null || true
ssh -i "$AWS_KEY" -o StrictHostKeyChecking=no -N -L 4000:localhost:4000 -L 9101:localhost:9101 "${AWS_USER}@${AWS_HOST}" &
TUNNEL_PID=$!
echo "✅ Tunnels active! Access LiteLLM at http://localhost:4000/ui. Observability is managed via Grafana Cloud."

echo "=========================================================="
echo "✅ Deployment over Rsync to AWS Successful!"
echo "=========================================================="

echo "\n📡 Tailing live docker logs for 'backend', 'litellm' and 'litellm-db' containers (Press Ctrl+C to exit)..."
# Disable the ERR trap before jumping into the interactive SSH log tail, 
# so that pressing Ctrl+C gracefully exits instead of throwing "Deployment failed!"
trap - ERR
ssh -t -i "$AWS_KEY" -o StrictHostKeyChecking=no "${AWS_USER}@${AWS_HOST}" "cd ${REMOTE_DIR} && sudo docker compose logs -f backend litellm" || true
