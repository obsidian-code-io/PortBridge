# syntax=docker/dockerfile:1

# --- Stage 1: install workspace dependencies ---
FROM oven/bun:1.1-alpine AS deps
WORKDIR /app
# Copy the workspace manifests so bun can resolve the whole workspace graph.
COPY package.json bun.lock* ./
COPY apps/server/package.json apps/server/
COPY packages/protocol/package.json packages/protocol/
COPY packages/tunnel-core/package.json packages/tunnel-core/
COPY packages/cli/package.json packages/cli/
RUN bun install --frozen-lockfile || bun install

# --- Stage 2: runtime ---
FROM oven/bun:1.1-alpine AS runtime
WORKDIR /app

# NON-ROOT TRADEOFF:
# The container mounts /var/run/docker.sock, which is root:docker on the host.
# We run as the image's built-in unprivileged `bun` user rather than root, but
# that user must be a member of the host's docker group to read the socket.
# Grant this in compose via `group_add: ["<docker-gid>"]` (see docker-compose.yml),
# or avoid the socket mount entirely by pointing DOCKER_HOST at a
# tecnativa/docker-socket-proxy. Mounting the raw socket is root-equivalent.

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
# The server only needs its own source plus the shared protocol package.
COPY packages/protocol ./packages/protocol
COPY apps/server ./apps/server

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

WORKDIR /app/apps/server
USER bun
CMD ["bun", "run", "src/index.ts"]
