# syntax=docker/dockerfile:1

# --- Stage 1: install production dependencies ---
FROM oven/bun:1.1-alpine AS deps
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --production --frozen-lockfile || bun install --production

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
COPY package.json tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER bun
CMD ["bun", "run", "src/index.ts"]
