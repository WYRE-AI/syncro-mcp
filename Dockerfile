# Multi-stage build for efficient container size
FROM node:26-alpine AS builder

# Build arguments
ARG VERSION="unknown"
ARG COMMIT_SHA="unknown"
ARG BUILD_DATE="unknown"
# GitHub PAT with read:packages, used only to install @wyre-technology/* from
# GitHub Packages. Build-time only; never baked into the final image.
# DigitalOcean App Platform supplies this as a build-time env var (it does not
# support BuildKit secret mounts), so we accept it both as a build ARG and via
# the NPM_TOKEN secret mount used by CI / local docker buildx.
ARG GITHUB_TOKEN=""

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy .npmrc for GitHub Package Registry access
COPY .npmrc ./

# Install dependencies (--ignore-scripts prevents 'prepare' from running before source is copied)
# Authenticate to GitHub Packages using either the NPM_TOKEN BuildKit secret
# (CI / local docker buildx) or the GITHUB_TOKEN build ARG (DigitalOcean).
RUN --mount=type=secret,id=NPM_TOKEN \
    if [ -f /run/secrets/NPM_TOKEN ]; then \
      echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/NPM_TOKEN)" >> .npmrc; \
    elif [ -n "${GITHUB_TOKEN}" ]; then \
      echo "//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}" >> .npmrc; \
    fi && \
    npm ci --ignore-scripts && \
    sed -i '/_authToken/d' .npmrc

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:26-alpine AS production

# Create a non-root user for security
RUN addgroup -g 1001 -S syncro && \
    adduser -S syncro -u 1001 -G syncro

# Set working directory
WORKDIR /app

# Copy package files and built application from builder stage
COPY package*.json ./
COPY .npmrc ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Prune dev dependencies (avoids re-installing git deps which need build tools)
RUN npm prune --omit=dev && npm cache clean --force

# Create logs directory
RUN mkdir -p /app/logs && chown -R syncro:syncro /app

# Switch to non-root user
USER syncro

# Expose port for HTTP transport
EXPOSE 8080

# Health check against the HTTP endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Set environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_PORT=8080
ENV MCP_HTTP_HOST=0.0.0.0
# Default to env mode for backward compatibility; set to 'gateway' for hosted deployment
ENV AUTH_MODE=env

# Define volume for logs
VOLUME ["/app/logs"]

# Start the application directly (HTTP transport doesn't need the stdio wrapper)
CMD ["node", "dist/index.js"]

# Build arguments for runtime
ARG VERSION="unknown"
ARG COMMIT_SHA="unknown"
ARG BUILD_DATE="unknown"

# Labels for metadata
LABEL maintainer="engineering@wyre.ai"
LABEL version="${VERSION}"
LABEL description="Syncro MCP Server - Model Context Protocol server for Syncro MSP"
LABEL org.opencontainers.image.title="syncro-mcp"
LABEL org.opencontainers.image.description="Model Context Protocol server for Syncro MSP integration"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"
LABEL org.opencontainers.image.source="https://github.com/WYRE-AI/syncro-mcp"
LABEL org.opencontainers.image.documentation="https://github.com/WYRE-AI/syncro-mcp/blob/main/README.md"
LABEL org.opencontainers.image.url="https://github.com/WYRE-AI/syncro-mcp/pkgs/container/syncro-mcp"
LABEL org.opencontainers.image.vendor="Wyre Technology"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL io.modelcontextprotocol.server.name="io.github.WYRE-AI/syncro-mcp"
