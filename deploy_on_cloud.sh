#!/bin/bash

# Enable strict mode
set -e

echo "=========================================================="
echo "☁️  Building and Deploying SAI natively on AWS ☁️"
echo "=========================================================="

cd ~/sai-deployment

# 0. Free up occupied ports (9100, 9101, 4000)
echo "Freeing up occupied ports..."
sudo lsof -ti:9100,9101,4000 | xargs sudo kill -9 2>/dev/null || true

# 1. Stop Existing Services
echo "\n[1/2] Stopping existing SAI services..."
docker compose down || true

# 2. Start and Build New Services
echo "\n[2/2] Building and Starting SAI natively on Ubuntu..."
docker compose up --build -d

echo "=========================================================="
echo "✅ SAI deployment successful! Containers are running."
echo "=========================================================="

echo "\nActive Containers:"
docker ps --filter "name=sai" --format "table {{.Names}}\t{{.ID}}\t{{.Ports}}"
