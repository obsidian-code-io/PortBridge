import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Config } from "../../config.ts";
import type { AppEnv } from "../env.ts";
import type { AuditWriter } from "../../audit/types.ts";
import { RateLimiter } from "../../auth/ratelimit.ts";
import { createSession, verifySession, SESSION_COOKIE } from "../../auth/session.ts";
import { tokenMatches } from "../../auth/token.ts";
import { loginPage } from "../views/login.ts";

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded !== undefined) return forwarded.split(",")[0]?.trim() ?? "unknown";
  return c.req.header("x-real-ip") ?? "unknown";
}

function isSecure(c: Context): boolean {
  if (c.req.header("x-forwarded-proto") === "https") return true;
  return new URL(c.req.url).protocol === "https:";
}

function issueSession(c: Context, config: Config): void {
  const { cookie } = createSession(config.adminToken);
  setCookie(c, SESSION_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: isSecure(c),
    maxAge: 24 * 60 * 60,
  });
}

async function handleLogin(c: Context, config: Config, audit: AuditWriter, limiter: RateLimiter) {
  const ip = clientIp(c);
  if (!limiter.check(ip)) {
    audit.write({ actor: ip, action: "login_fail", detail: "rate_limited" });
    return c.html(loginPage("Too many attempts. Try again later."), 429);
  }
  const token = (await c.req.parseBody())["token"];
  if (typeof token === "string" && tokenMatches(token, config.adminToken)) {
    issueSession(c, config);
    audit.write({ actor: ip, action: "login_ok" });
    return c.redirect("/", 302);
  }
  audit.write({ actor: ip, action: "login_fail" });
  return c.html(loginPage("Invalid token."), 401);
}

export function loginRoutes(config: Config, audit: AuditWriter): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const limiter = new RateLimiter(LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);

  router.get("/login", (c) => {
    if (verifySession(config.adminToken, getCookie(c, SESSION_COOKIE)) !== undefined) {
      return c.redirect("/", 302);
    }
    return c.html(loginPage());
  });

  router.post("/login", (c) => handleLogin(c, config, audit, limiter));

  router.post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    c.header("HX-Redirect", "/login");
    return c.body(null, 200);
  });

  return router;
}
