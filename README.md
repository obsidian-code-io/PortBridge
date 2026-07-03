# PortBridge

Self-hosted Docker port-forwarding for admins. Browse containers on a host and
open temporary TCP forwards to any internal container port — implemented as
short-lived `alpine/socat` sidecar containers, not an in-process proxy.

> ## ⚠️ Mounting the Docker socket is root-equivalent
>
> PortBridge needs access to `/var/run/docker.sock`. **Anything that can talk to
> the Docker socket can take full control of the host** (mount `/`, run
> privileged containers, read every secret). Treat the admin token like root
> credentials, always run PortBridge behind TLS, and strongly prefer the
> [`tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy)
> deployment (`docker-compose.socket-proxy.yml`) over mounting the raw socket.

## How it works

- **State lives in Docker labels.** Active forwards are always reconstructed by
  listing containers with `portbridge.managed=true` and reading their labels
  (`docker/forwards.ts` → `listForwards()`). SQLite is an **append-only audit
  log only** — never the source of truth. A `docker restart` of PortBridge
  loses nothing: the forwards are re-read from the running sidecars.
- **Sidecars, not a proxy.** Each forward is a pinned `alpine/socat` container
  (`TCP-LISTEN` → `TCP-CONNECT`) with a published host port, 32 MB / 0.1 CPU,
  `CapDrop: ALL`, `restart: unless-stopped`.
- **Fail closed.** Invalid config aborts boot. Every route except `/login` and
  `/healthz` (and `/public/*`) requires a valid session. Deny by default.

## Stack

Bun · Hono · HTMX + server-rendered templates + Tailwind · dockerode ·
`bun:sqlite` · UUIDv7.

## Configuration (env)

| Var | Default | Notes |
| --- | --- | --- |
| `ADMIN_TOKEN` | — | **Required**, ≥16 chars. Boot fails otherwise. Never logged. |
| `PORT` | `8080` | HTTP listen port for the UI. |
| `PORT_RANGE` | `30000-30999` | Host ports forwards may publish. |
| `DEFAULT_TTL_MINUTES` | `60` | Default forward lifetime. |
| `MAX_FORWARDS` | `50` | Hard cap on concurrent managed sidecars. |
| `SOCAT_IMAGE` | `alpine/socat:1.8.0.0` | **Pin to a digest in production** (see below). |
| `DOCKER_HOST` | — | Optional; point at a socket-proxy (`tcp://…:2375`). |
| `DATA_DIR` | `/app/data` | SQLite audit DB location. |

> **Pin the socat image.** The coded default is a tag for convenience. In
> production set `SOCAT_IMAGE=alpine/socat:1.8.0.0@sha256:<digest>` so the
> sidecar image cannot drift. Get the digest with
> `docker buildx imagetools inspect alpine/socat:1.8.0.0`.

## Quick start (dev)

```bash
bun install
ADMIN_TOKEN=change-me-to-16+chars bun run dev
curl -s localhost:8080/healthz          # {"ok":true} when the Docker socket responds
bun test && bun run typecheck            # 37 tests + strict typecheck
```

## Deploy

- **Simple (raw socket):** `docker-compose.yml`. Set a strong `ADMIN_TOKEN` and
  the host docker group GID for `group_add` (`getent group docker | cut -d: -f3`).
- **Hardened (recommended):** `docker-compose.socket-proxy.yml` — no raw socket,
  Docker reached through a deny-by-default proxy.

Images publish to `ghcr.io/obsidiancode/portbridge` from the `release` workflow
on a `v*` tag.

## Security notes

### The socket is root-equivalent
See the warning at the top. Use the socket-proxy deployment when you can.

### Published ports bypass `ufw`
Docker inserts its own `iptables` rules ahead of `ufw`, so a forward that
publishes `0.0.0.0:30000` is reachable **even if `ufw` denies 30000**. Do not
rely on `ufw` to fence the forward range. Instead:

- restrict `PORT_RANGE` at the **cloud firewall / security group** (the layer
  Docker cannot bypass), and/or
- bind the range to a private interface at the provider level.

### docker-socket-proxy — minimum permission set
PortBridge needs exactly: **containers** list/inspect/create/delete/logs,
**networks** list/inspect, **images** pull, and **ping**. That maps to the
proxy env `CONTAINERS=1 NETWORKS=1 IMAGES=1 POST=1 PING=1` with everything else
`0` (see `docker-compose.socket-proxy.yml`). `POST=1` is required for
create/delete/connect and image pull; it is still far narrower than the raw
socket.

### Known limitations (v1)
- **`127.0.0.1`-bound targets are unreachable.** A target that binds only to its
  own loopback (e.g. `127.0.0.1:5432`) can't be reached from a sidecar on a
  shared network. Use the **sidecar log viewer** (`/forwards/:id/logs`) to
  diagnose — you'll see socat connection refusals. (netns-join is v2.)
- **Default-bridge targets are reached by IP, not name.** Docker's embedded DNS
  only resolves names on user-defined networks; on the default `bridge` we
  connect to the target's current IP, which can change if the target restarts.
  Put shared services on a user-defined network for stable name resolution.
- **Single-node scope.** No multi-node Swarm; forwards are local to the host
  PortBridge runs on.

## Out of scope (v2)

Traefik HTTP temp-subdomain forwards, source-IP allowlists, netns-join for
`127.0.0.1` targets, multi-user auth/roles, UDP, multi-node Swarm, Prometheus
metrics. Extension points are left clean (the `portbridge.created.by` label and
the `tcp`-only forward-kind enum).

## Acceptance criteria

| # | Criterion | Where |
| --- | --- | --- |
| 1 | Deploy via compose, login | `docker-compose*.yml`, `routes/login.ts` |
| 2 | Forward to a no-published-port container on a user network | `resolveNetwork` (name mode), tested |
| 3 | Plain-bridge container via IP mode | `resolveNetwork` (bridge fallback), tested |
| 4 | 15m TTL auto-expires + audit + port closed | `reaper.ts`, tested |
| 5 | `docker restart` PortBridge → forwards still listed | `listForwards()` from labels, tested |
| 6 | 6 bad logins → rate limited; no route open without session | `ratelimit.ts` + `authGuard`, tested |
| 7 | `MAX_FORWARDS` enforced | `createForward` (fail closed), tested |
| 8 | Manual `docker rm -f` sidecar → reconciled + audit row | `reaper.ts` reconciliation, tested |
| 9 | Code-quality limits hold | functions ≤50 lines, files ≤400, nesting ≤3, strict TS |

Logic-level criteria (2–5, 7, 8) are covered by unit/integration tests over a
stateful fake Docker; full end-to-end (2–4) needs a real Docker host.
