import { describe, expect, test } from "bun:test";
import { createSession, verifySession } from "../src/auth/session.ts";
import { tokenMatches, bearerToken } from "../src/auth/token.ts";
import { csrfValid } from "../src/auth/csrf.ts";
import { RateLimiter } from "../src/auth/ratelimit.ts";

const TOKEN = "0123456789abcdef0123";

describe("session", () => {
  test("round-trips and exposes a csrf nonce", () => {
    const { cookie, csrf } = createSession(TOKEN);
    const session = verifySession(TOKEN, cookie);
    expect(session?.csrf).toBe(csrf);
    expect(session?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test("rejects a tampered payload", () => {
    const { cookie } = createSession(TOKEN);
    const tampered = cookie.replace(/^[^.]+/, Buffer.from('{"exp":9999999999,"csrf":"x"}').toString("base64url"));
    expect(verifySession(TOKEN, tampered)).toBeUndefined();
  });

  test("rejects a cookie signed with a different token (rotation invalidates)", () => {
    const { cookie } = createSession(TOKEN);
    expect(verifySession("a-totally-different-token", cookie)).toBeUndefined();
  });

  test("rejects malformed / empty cookies", () => {
    expect(verifySession(TOKEN, undefined)).toBeUndefined();
    expect(verifySession(TOKEN, "garbage")).toBeUndefined();
  });
});

describe("token", () => {
  test("matches exact token, rejects near-misses and empties", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN + "x", TOKEN)).toBe(false);
    expect(tokenMatches("", TOKEN)).toBe(false);
  });
  test("parses Bearer header", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("bearer  spaced")).toBe("spaced");
    expect(bearerToken("Basic abc")).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });
});

describe("csrf", () => {
  test("accepts matching nonce, rejects mismatch/empty", () => {
    const session = { exp: 1, csrf: "deadbeef" };
    expect(csrfValid(session, "deadbeef")).toBe(true);
    expect(csrfValid(session, "nope")).toBe(false);
    expect(csrfValid(session, undefined)).toBe(false);
  });
});

describe("RateLimiter", () => {
  test("allows up to max then blocks", () => {
    const limiter = new RateLimiter(5, 60_000);
    for (let i = 0; i < 5; i += 1) expect(limiter.check("ip")).toBe(true);
    expect(limiter.check("ip")).toBe(false); // 6th blocked
    expect(limiter.check("other-ip")).toBe(true); // keyed per IP
  });
});
