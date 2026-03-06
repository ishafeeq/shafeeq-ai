#!/bin/bash

# Enable strict mode
set -e

# Exit immediately if a command exits with a non-zero status
trap 'echo -e "\n❌ Deployment failed!"; exit 1' ERR

echo "=========================================================="
echo "🚀 Syncing and Deploying Bol AI to AWS Cloud 🚀"
echo "=========================================================="

# AWS Connection Details
AWS_KEY="/Users/shafeeq/Documents/01-New-Job/Prep/ai-serv/my-aws-server-key.pem"
AWS_USER="ubuntu"
AWS_HOST="ec2-16-170-206-204.eu-north-1.compute.amazonaws.com"
REMOTE_DIR="~/bol-ai-deployment"

# Ensure AWS key exists
if [ ! -f "$AWS_KEY" ]; then
    echo "❌ Error: AWS Key not found at $AWS_KEY"
    exit 1
fi

# Ensure correct permissions on key
chmod 400 "$AWS_KEY"

# 1. Prepare Remote Directory
echo "\n[1/3] Preparing remote deployment directory..."
ssh -i "$AWS_KEY" -o StrictHostKeyChecking=no "${AWS_USER}@${AWS_HOST}" "mkdir -p ${REMOTE_DIR}"

# 2. Sync Codebase using Rsync
echo "\n[2/3] Synchronizing codebase to AWS EC2 via Rsync..."
rsync -avz --progress \
    -e "ssh -i '$AWS_KEY' -o StrictHostKeyChecking=no" \
    --exclude 'node_modules/' \
    --exclude 'venv/' \
    --exclude '.venv/' \
    --exclude '__pycache__/' \
    --exclude '.git/' \
    --exclude '.DS_Store' \
    --exclude 'build/' \
    --exclude '.env' \
    ./ "${AWS_USER}@${AWS_HOST}:${REMOTE_DIR}/"

# 3. Execute Cloud Deployment Script
echo "\n[3/3] Executing deployment on AWS Cloud..."
ssh -i "$AWS_KEY" -o StrictHostKeyChecking=no "${AWS_USER}@${AWS_HOST}" "cd ${REMOTE_DIR} && chmod +x deploy_on_cloud.sh && chmod +x setup_cloud_proxy.sh && ./deploy_on_cloud.sh"

echo "=========================================================="
echo "✅ Deployment over Rsync to AWS Successful!"
echo "=========================================================="
