#!/bin/bash

# Enable strict mode
set -e

# Cleanup on Ctrl-C
trap 'echo -e "\n❌❌❌ Gracefully stopping all services..."; docker-compose down; exit 0' SIGINT

echo "Building and starting Docker containers in the background..."
docker-compose up --build -d

echo ""
echo ""
echo ""
echo ""
echo ""
echo "======================================================================================================================"
echo "Fetching Network IP..."
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || ipconfig getifaddr en2 2>/dev/null || echo "unknown")

echo ""
echo "==========================================================="
echo "   Bol AI Docker Stack is running! 🐳"
echo "==========================================================="
echo "   ACCESS THE APP:"
echo "   ✅✅✅>> Frontend ( React ):   http://localhost:9100"
echo "   ✅✅✅>> Backend ( FastAPI ):   http://localhost:9101"
echo ""
echo "   ACCESS THE APP:"
echo "   ✅✅✅>> Local:   http://localhost:9100"
if [ "$LAN_IP" != "unknown" ]; then
echo "   ✅✅✅>> Network: http://${LAN_IP}:9100  ← use this on your mobile device"
else
echo "   ❌❌❌>> Network: Could not determine LAN IP automatically"
fi
echo "==========================================================="
echo ""
echo "Active Containers:"
docker ps --filter "name=bol-ai" --format "table {{.Names}}\t{{.ID}}\t{{.Ports}}"
echo ""

echo "Attaching to live logs... (Press Ctrl+C to stop services)"
echo "======================================================================================================================"
echo ""
echo ""
echo ""
echo ""
echo ""

# Attach to logs and wait
docker-compose logs -f
