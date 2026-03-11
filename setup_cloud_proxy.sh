#!/bin/bash
set -e

echo "=========================================================="
echo "🚀 Setting up Nginx Reverse Proxy on Ubuntu Cloud Server 🚀"
echo "=========================================================="

# 1. Update and install Nginx + Certbot
echo "[1/3] Installing Nginx and Certbot..."
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx

# 2. Copy the configuration file
echo "[2/3] Configuring Nginx..."
sudo cp cloud-apps.conf /etc/nginx/sites-available/cloud-apps.conf

# Enable the configuration by linking to sites-enabled
sudo ln -sf /etc/nginx/sites-available/cloud-apps.conf /etc/nginx/sites-enabled/

# Remove default nginx config if it exists
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
sudo nginx -t

# Restart Nginx to apply HTTP configs
sudo systemctl restart nginx
sudo systemctl enable nginx

echo "\n[3/3] Nginx configured on port 80 successfully!"
echo ""
echo "=========================================================="
echo "🔐 Automating SSL / HTTPS Setup 🔐"
echo "=========================================================="
echo "Running certbot to auto-configure SSL for Nginx..."
sudo certbot --nginx -d gosmarthome.in -d www.gosmarthome.in -d shafeeq.dev -d www.shafeeq.dev -d sai.shafeeq.dev --non-interactive --agree-tos --register-unsafely-without-email
echo "=========================================================="
