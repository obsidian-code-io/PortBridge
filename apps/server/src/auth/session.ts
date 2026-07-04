/**
 * Stateless signed session cookie. The HMAC key is derived from ADMIN_TOKEN via
 * HKDF-SHA256, so rotating the token invalidates every existing session. The
 * payload carries an expiry and a per-session CSRF nonce; both are covered by
 * the signature and therefore tamper-proof. The admin token is never stored in
 * the cookie or logged.
 */

import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { constantTimeEqual } from "./compare.ts";

export const SESSION_COOKIE = "pb_session";
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const HKDF_SALT = "portbridge.session.v1";
const HKDF_INFO = "session-hmac-key";

export interface Session {
  readonly exp: number;
  readonly csrf: string;
  readonly sub: string; // principal subject: "admin" or "u:<keyId>"
}

function sessionKey(adminToken: string): Buffer {
  const key = hkdfSync("sha256", Buffer.from(adminToken, "utf8"), Buffer.from(HKDF_SALT), Buffer.from(HKDF_INFO), 32);
  return Buffer.from(key);
}

function sign(adminToken: string, payload: string): string {
  return createHmac("sha256", sessionKey(adminToken)).update(payload).digest("base64url");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createSession(adminToken: string, sub = "admin"): { cookie: string; csrf: string } {
  const csrf = randomBytes(16).toString("hex");
  const exp = nowSeconds() + SESSION_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ exp, csrf, sub }), "utf8").toString("base64url");
  return { cookie: `${payload}.${sign(adminToken, payload)}`, csrf };
}

function parsePayload(payload: string): Session | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec["exp"] !== "number" || typeof rec["csrf"] !== "string") return undefined;
  if (rec["exp"] < nowSeconds()) return undefined;
  const sub = typeof rec["sub"] === "string" ? rec["sub"] : "admin";
  return { exp: rec["exp"], csrf: rec["csrf"], sub };
}

export function verifySession(adminToken: string, cookie: string | undefined): Session | undefined {
  if (cookie === undefined || cookie === "") return undefined;
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const payload = cookie.slice(0, dot);
  const signature = cookie.slice(dot + 1);
  if (!constantTimeEqual(signature, sign(adminToken, payload))) return undefined;
  return parsePayload(payload);
}
