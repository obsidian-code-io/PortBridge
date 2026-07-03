import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Docker from "dockerode";
import type { Config } from "../src/config.ts";
import type { AuditEvent, AuditReader, AuditWriter } from "../src/audit/types.ts";
import { createApp } from "../src/web/app.ts";
import { BrandStore } from "../src/brand/store.ts";

const TOKEN = "0123456789abcdef0123";
const DATA_DIR = mkdtempSync(join(tmpdir(), "pb-app-"));
afterAll(() => rmSync(DATA_DIR, { recursive: true, force: true }));

const CONFIG: Config = {
  adminToken: TOKEN,
  port: 8080,
  portRange: { start: 30000, end: 30999 },
  defaultTtlMinutes: 60,
  maxForwards: 50,
  socatImage: "alpine/socat:test",
  dockerHost: undefined,
  dataDir: DATA_DIR,
};

// These tests exercise auth/forwards, not onboarding — treat the app as onboarded.
new BrandStore(DATA_DIR).setOnboarding({ onboarded: true });

function fakeDocker() {
  return {
    ping: async () => "OK",
    listContainers: async () => [],
    getContainer: () => ({ inspect: async () => ({ Id: "self", Config: {}, NetworkSettings: {} }) }),
  } as unknown as Docker;
}

function harness() {
  const events: AuditEvent[] = [];
  const audit: AuditWriter & AuditReader = { write: (e) => events.push(e), query: () => [] };
  const { app } = createApp(fakeDocker(), CONFIG, audit, audit);
  return { app, events };
}

function form(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  };
}

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0] ?? "";
}

describe("auth surface", () => {
  test("healthz is public", async () => {
    const { app } = harness();
    expect((await app.request("/healthz")).status).toBe(200);
  });

  test("dashboard redirects to /login without a session", async () => {
    const { app } = harness();
    const res = await app.request("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  test("wrong token fails and is audited; right token sets a cookie", async () => {
    const { app, events } = harness();
    const bad = await app.request("/login", form({ token: "wrong" }));
    expect(bad.status).toBe(401);

    const ok = await app.request("/login", form({ token: TOKEN }));
    expect(ok.status).toBe(302);
    expect(cookieFrom(ok)).toContain("pb_session=");
    expect(events.map((e) => e.action)).toEqual(["login_fail", "login_ok"]);
  });

  test("a valid session unlocks the dashboard with CSRF wired in", async () => {
    const { app } = harness();
    const login = await app.request("/login", form({ token: TOKEN }));
    const res = await app.request("/", { headers: { cookie: cookieFrom(login) } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("X-CSRF-Token");
    expect(body).toContain("sign out");
  });

  test("POST without CSRF is 403; with the session CSRF it passes the guard", async () => {
    const { app } = harness();
    const login = await app.request("/login", form({ token: TOKEN }));
    const cookie = cookieFrom(login);
    const page = await (await app.request("/", { headers: { cookie } })).text();
    const csrf = /X-CSRF-Token":"([0-9a-f]+)"/.exec(page)?.[1] ?? "";

    const noCsrf = await app.request("/forwards", {
      ...form({}),
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    });
    expect(noCsrf.status).toBe(403);

    const withCsrf = await app.request("/forwards", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie, "x-csrf-token": csrf },
      body: new URLSearchParams({}).toString(),
    });
    expect(withCsrf.status).not.toBe(403); // passes CSRF; fails later on empty input
  });

  test("rate limit blocks the 6th login attempt", async () => {
    const { app } = harness();
    let last = 0;
    for (let i = 0; i < 6; i += 1) {
      last = (await app.request("/login", form({ token: "wrong" }))).status;
    }
    expect(last).toBe(429);
  });

  test("/api/* takes a Bearer token instead of a cookie", async () => {
    const { app } = harness();
    const missing = await app.request("/api/anything");
    expect(missing.status).toBe(401);
    const wrong = await app.request("/api/anything", { headers: { authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
    // correct bearer passes the guard (no such route beyond it -> 404, not 401)
    const ok = await app.request("/api/anything", { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(ok.status).toBe(404);
  });
});
