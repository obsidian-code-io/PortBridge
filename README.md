# PortBridge

Self-hosted Docker port-forwarding for admins. Browse containers on a host and
open temporary TCP forwards to any internal container port — implemented as
short-lived `alpine/socat` sidecar containers, not an in-process proxy.

> ## ⚠️ Mounting the Docker socket is root-equivalent
>
> PortBridge requires access to `/var/run/docker.sock`. Anything that can talk
> to the Docker socket can take full control of the host. Treat the admin token
> like root credentials, put PortBridge behind TLS, and prefer a
> [`tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy)
> with a minimal permission set over mounting the raw socket. See the security
> notes below (expanded in later phases).

## How it works

- **State lives in Docker labels.** Active forwards are always reconstructed by
  listing containers with `portbridge.managed=true` and reading their labels.
  SQLite is an **append-only audit log only** — never the source of truth.
- **Sidecars, not a proxy.** Each forward is a pinned `alpine/socat` container
  with a published host port that relays TCP to the target's internal port.
- **Fail closed.** Invalid config aborts boot. Every route except `/login` and
  `/healthz` requires a valid session.

## Stack

Bun · Hono · HTMX + server-rendered templates + Tailwind · dockerode ·
`bun:sqlite` · UUIDv7.

## Configuration (env)

| Var | Default | Notes |
| --- | --- | --- |
| `ADMIN_TOKEN` | — | **Required**, ≥16 chars. Boot fails otherwise. |
| `PORT` | `8080` | HTTP listen port for the UI. |
| `PORT_RANGE` | `30000-30999` | Host ports the forwards may publish. |
| `DEFAULT_TTL_MINUTES` | `60` | Default forward lifetime. |
| `MAX_FORWARDS` | `50` | Hard cap on concurrent managed sidecars. |
| `SOCAT_IMAGE` | `alpine/socat:1.8.0.0` | Pin to a digest in production. |
| `DOCKER_HOST` | — | Optional; point at a socket-proxy. |
| `DATA_DIR` | `/app/data` | SQLite audit DB location. |

## Quick start (dev)

```bash
bun install
ADMIN_TOKEN=change-me-to-16+chars bun run dev
curl -s localhost:8080/healthz   # {"ok":true} when the Docker socket responds
```

## Deploy

See `docker-compose.yml` (dokploy-network + Traefik). Set a strong `ADMIN_TOKEN`
and pick the host's docker group GID for `group_add`.

## Security notes (WIP)

- The socket is root-equivalent — see the warning above.
- **Firewall caveat:** published sidecar ports bypass `ufw`; restrict
  `PORT_RANGE` at the cloud firewall. (Expanded in Phase 6.)
- Single-node scope; multi-node Swarm is out of scope for v1.

## Build phases

This repo is being built in reviewed phases (0–6). Current: **Phase 0 —
scaffold** (config, `/healthz`, Dockerfile, compose, this stub).
