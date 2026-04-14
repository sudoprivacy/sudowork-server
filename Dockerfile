# Sudowork-Server Dockerfile
# Multi-stage build with frontend admin panel

# ============================================
# Stage 1: Frontend Build
# ============================================
FROM oven/bun:1-debian AS frontend-builder

WORKDIR /app/admin

# Install build tools (some node modules may need them)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential && rm -rf /var/lib/apt/lists/*

# Copy admin frontend files
COPY admin/package.json admin/bun.lock ./
RUN bun install --frozen-lockfile

# Copy all admin files and build
COPY admin/ ./
RUN bunx vite build

# ============================================
# Stage 2: Backend Dependencies
# ============================================
FROM oven/bun:1-debian AS backend-deps

WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# ============================================
# Stage 3: Production Build
# ============================================
FROM oven/bun:1-debian AS production

WORKDIR /app

# Install runtime tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    redis-tools curl && rm -rf /var/lib/apt/lists/*

# Copy backend dependencies
COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=backend-deps /app/package.json ./

# Copy backend source
COPY src ./src
COPY tsconfig.json ./

# Copy built frontend from Stage 1 (vite outputs to ../admin-dist)
COPY --from=frontend-builder /app/admin-dist ./admin-dist

# Create data directory with proper permissions
RUN mkdir -p /app/data && chmod 777 /app/data

# Expose port
EXPOSE 3000

# Health check using curl (more reliable)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# Set production environment
ENV NODE_ENV=production

# Start the application
CMD ["bun", "run", "src/index.ts"]
