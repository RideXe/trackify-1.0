# ─────────────────────────────────────────────────────────────
# Stage 1 – Build the React/Vite frontend
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Copy package files + .npmrc first (legacy-peer-deps=true must be present before npm ci)
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# Copy the rest of the source
COPY . .

# Build the production bundle
RUN npm run build

# ─────────────────────────────────────────────────────────────
# Stage 2 – Serve with Nginx and proxy /api to the backend
# ─────────────────────────────────────────────────────────────
FROM nginx:stable-alpine
LABEL org.opencontainers.image.title="Trackify Web Dashboard"

# Remove the default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Add our custom config (created alongside this Dockerfile)
COPY nginx.conf /etc/nginx/conf.d/trackify.conf

# Copy the built React app
COPY --from=builder /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
