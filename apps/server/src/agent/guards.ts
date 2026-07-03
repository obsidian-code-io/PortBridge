/**
 * Upgrade guards for the agent WebSocket endpoints.
 *
 * SECURITY INVARIANT: the control channel authenticates with an
 * `Authorization: Bearer` header. Browsers cannot set custom headers on a
 * WebSocket upgrade, so this endpoint is unreachable from any browser page — we
 * additionally reject upgrades carrying an `Origin` header as defense in depth.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { Config } from "../config.ts";
import type { AuditWriter } from "../audit/types.ts";
import { RateLimiter } from "../auth/ratelimit.ts";
import { bearerToken, tokenMatches } from "../auth/token.ts";

const AUTH_MAX_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_GLOBAL_MAX = 100;

function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded !== undefined) return forwarded.split(",")[0]?.trim() ?? "unknown";
  return c.req.header("x-real-ip") ?? "unknown";
}

/**
 * Bearer-header auth + Origin rejection + failed-attempt rate limiting.
 *
 * The per-IP limiter keys on X-Forwarded-For / X-Real-IP, which a direct
 * (non-proxied) client can spoof to dodge the per-IP lockout — so a
 * non-spoofable GLOBAL backstop caps total failed attempts across all IPs. The
 * admin token is high-entropy, so this is defense-in-depth, not the primary
 * control. (Behind a trusted reverse proxy, X-Forwarded-For is authoritative.)
 */
export function agentControlGuard(config: Config, audit: AuditWriter): MiddlewareHandler {
  const perIp = new RateLimiter(AUTH_MAX_ATTEMPTS, AUTH_WINDOW_MS);
  const global = new RateLimiter(AUTH_GLOBAL_MAX, AUTH_WINDOW_MS);
  return async (c, next) => {
    if (c.req.header("origin") !== undefined) return c.text("origin not allowed", 403);
    const token = bearerToken(c.req.header("authorization"));
    if (token !== undefined && tokenMatches(token, config.adminToken)) return next();
    const ipOk = perIp.check(clientIp(c));
    const globalOk = global.check("global");
    const allowed = ipOk && globalOk;
    audit.write({ actor: clientIp(c), action: "agent_auth_fail", detail: allowed ? undefined : "rate_limited" });
    return c.text(allowed ? "unauthorized" : "rate limited", allowed ? 401 : 429);
  };
}

/** Data channel auth is the in-band token handshake; reject browser Origins here. */
export function agentStreamGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header("origin") !== undefined) return c.text("origin not allowed", 403);
    return next();
  };
}
