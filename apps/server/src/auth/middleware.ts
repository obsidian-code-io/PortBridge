/**
 * Deny-by-default guard. Every route is protected except /login, /healthz, and
 * /public/*. Browser requests without a valid session are redirected to /login
 * (HX-Redirect for HTMX); /api/* accepts a Bearer credential (the admin token
 * or a per-user API key). Both paths resolve a Principal onto the context for
 * downstream scope enforcement. Unsafe methods additionally require CSRF.
 */

import type { Context, MiddlewareHandler, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { Config } from "../config.ts";
import type { AppEnv } from "../web/env.ts";
import type { AccessStore } from "../access/store.ts";
import { principalFromSub, resolvePrincipal } from "../access/resolver.ts";
import { SESSION_COOKIE, verifySession, type Session } from "./session.ts";
import { bearerToken } from "./token.ts";
import { csrfValid, CSRF_HEADER } from "./csrf.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isPublic(path: string): boolean {
  return path === "/login" || path === "/healthz" || path.startsWith("/public/");
}

function unauthorized(c: Context): Response {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "unauthorized" }, 401);
  if (c.req.header("HX-Request") === "true") {
    c.header("HX-Redirect", "/login");
    return c.body(null, 401);
  }
  return c.redirect("/login", 302);
}

function csrfOk(c: Context, session: Session): boolean {
  if (SAFE_METHODS.has(c.req.method)) return true;
  return csrfValid(session, c.req.header(CSRF_HEADER));
}

export function authGuard(config: Config, access: AccessStore): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    if (isPublic(c.req.path)) return next();
    // /api/* authenticates by Bearer credential (admin token or per-user key).
    if (c.req.path.startsWith("/api/")) {
      const principal = resolvePrincipal(config, access, bearerToken(c.req.header("authorization")));
      if (principal === undefined) return unauthorized(c);
      c.set("principal", principal);
      return next();
    }
    const session = verifySession(config.adminToken, getCookie(c, SESSION_COOKIE));
    if (session === undefined) return unauthorized(c);
    const principal = principalFromSub(access, session.sub);
    if (principal === undefined) return unauthorized(c); // revoked key / deleted role ⇒ re-login
    if (!csrfOk(c, session)) return c.text("invalid CSRF token", 403);
    c.set("csrf", session.csrf);
    c.set("principal", principal);
    return next();
  };
}
