############################################################
# Single Dockerfile for both dev/prod (use build target)
# - dev  : Vite dev server (port 5173)
# - prod : Static build served by nginx (port 3000)
############################################################

# ===== Dev stage =====
FROM node:20-alpine AS dev

WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm i
COPY . .

EXPOSE 5173
CMD ["pnpm", "run", "dev", "--host", "0.0.0.0", "--port", "5173"]

# ===== Build stage =====
FROM node:20-alpine AS build

WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm i --frozen-lockfile
COPY . .

# Vite envs are injected at build time
ARG VITE_API_URL
ARG VITE_SOCKET_URL
ARG VITE_EXTRACT_ASYNC
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SOCKET_URL=${VITE_SOCKET_URL}
ENV VITE_EXTRACT_ASYNC=${VITE_EXTRACT_ASYNC}

RUN pnpm build

# ===== Prod stage =====
FROM nginx:alpine AS prod

# SPA routing + basic caching
RUN cat > /etc/nginx/conf.d/default.conf <<'EOF'
server {
  listen 3000;
  server_name _;

  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires 30d;
    add_header Cache-Control "public, immutable";
    try_files $uri =404;
  }
}
EOF

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 3000

