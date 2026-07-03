/**
 * Deny-by-default guard. Every route is protected except /login, /healthz, and
 * /public/*. Browser requests without a valid session are redirected to /login
 * (HX-Redirect for HTMX); /api/* accepts a Bearer admin token instead. Unsafe
 * methods additionally require a matching CSRF token.
 */

import type { Context, MiddlewareHandler, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { Config } from "../config.ts";
import type { AppEnv } from "../web/env.ts";
import { SESSION_COOKIE, verifySession, type Session } from "./session.ts";
import { bearerToken, tokenMatches } from "./token.ts";
import { csrfValid, CSRF_HEADER } from "./csrf.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isPublic(path: string): boolean {
  return path === "/login" || path === "/healthz" || path.startsWith("/public/");
}

function bearerValid(c: Context, config: Config): boolean {
  const token = bearerToken(c.req.header("authorization"));
  return token !== undefined && tokenMatches(token, config.adminToken);
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

export function authGuard(config: Config): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    if (isPublic(c.req.path)) return next();
    if (c.req.path.startsWith("/api/") && bearerValid(c, config)) return next();
    const session = verifySession(config.adminToken, getCookie(c, SESSION_COOKIE));
    if (session === undefined) return unauthorized(c);
    if (!csrfOk(c, session)) return c.text("invalid CSRF token", 403);
    c.set("csrf", session.csrf);
    return next();
  };
}
