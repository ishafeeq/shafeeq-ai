# Stage 1: Build the Vite application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy application source code and build
COPY . .
RUN npm run build

# Stage 2: Serve with Nginx Reverse Proxy
FROM nginx:alpine

# Create nginx cache directories and set permissions to allow temporary audio data uploads
RUN mkdir -p /var/cache/nginx/client_temp /var/cache/nginx/proxy_temp \
    /var/cache/nginx/fastcgi_temp /var/cache/nginx/uwsgi_temp /var/cache/nginx/scgi_temp && \
    chown -R nginx:nginx /var/cache/nginx && \
    chmod -R 777 /var/cache/nginx

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx configuration
COPY nginx-docker.conf /etc/nginx/conf.d/

# Copy built frontend assets
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
