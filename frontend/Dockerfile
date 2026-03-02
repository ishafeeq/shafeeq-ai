# Stage 1: Build the Vite application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package.json only to bypass corrupted package-lock.json permissions
COPY package.json ./

# Install dependencies without forcing the lockfile
RUN npm install

# Copy the rest of the source code explicitly
COPY src/ ./src/
COPY public/ ./public/
COPY index.html vite.config.ts tsconfig*.json eslint.config.js ./
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
