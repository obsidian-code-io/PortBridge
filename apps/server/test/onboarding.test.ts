import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Docker from "dockerode";
import type { Config } from "../src/config.ts";
import type { AuditReader, AuditWriter } from "../src/audit/types.ts";
import { createApp } from "../src/web/app.ts";

const TOKEN = "0123456789abcdef0123";
let dirs: string[] = [];
afterEach(() => {
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
  dirs = [];
});

function fakeDocker(): Docker {
  return {
    ping: async () => "OK",
    listContainers: async () => [],
    getContainer: () => ({ inspect: async () => ({ Id: "self", Config: {}, NetworkSettings: {} }) }),
  } as unknown as Docker;
}

function harness() {
  const dataDir = mkdtempSync(join(tmpdir(), "pb-onb-"));
  dirs.push(dataDir);
  const config: Config = {
    adminToken: TOKEN, port: 8080, portRange: { start: 30000, end: 30999 }, defaultTtlMinutes: 60,
    maxForwards: 50, socatImage: "x", dockerHost: undefined, dataDir,
  };
  const audit: AuditWriter & AuditReader = { write: () => undefined, query: () => [] };
  return createApp(fakeDocker(), config, audit, audit).app;
}

function form(fields: Record<string, string>, cookie: string, csrf: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie, "x-csrf-token": csrf },
    body: new URLSearchParams(fields).toString(),
  };
}

async function login(app: ReturnType<typeof harness>): Promise<{ cookie: string; csrf: string }> {
  const res = await app.request("/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: TOKEN }).toString(),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const page = await (await app.request("/onboarding", { headers: { cookie } })).text();
  const csrf = /X-CSRF-Token":"([0-9a-f]+)"/.exec(page)?.[1] ?? "";
  return { cookie, csrf };
}

describe("onboarding flow", () => {
  test("a not-onboarded app gates the dashboard to /onboarding", async () => {
    const app = harness();
    const { cookie } = await login(app);
    const res = await app.request("/", { headers: { cookie }, redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/onboarding");
  });

  test("resumable steps, validation, and landing branded", async () => {
    const app = harness();
    const { cookie, csrf } = await login(app);

    // Step 0 (basics) → advances to Branding
    let r = await app.request("/onboarding", form({ step: "0", action: "next", productName: "Acme Tunnels" }, cookie, csrf));
    expect(await r.text()).toContain("Branding essentials");

    // Step 1 with an inaccessible primary (near-white on the white bg) → error, no advance
    r = await app.request("/onboarding", form({ step: "1", action: "next", primary: "#eeeeee" }, cookie, csrf));
    const errText = await r.text();
    expect(errText).toMatch(/contrast|readable/i);

    // resumable: a fresh GET resumes at the persisted step (Branding), not the start
    expect(await (await app.request("/onboarding", { headers: { cookie } })).text()).toContain("Branding essentials");

    // Step 1 valid → Preferences
    r = await app.request("/onboarding", form({ step: "1", action: "next", primary: "#1d4ed8" }, cookie, csrf));
    expect(await r.text()).toContain("Preferences");

    // Step 2 finish → HX-Redirect to the app
    r = await app.request("/onboarding", form({ step: "2", action: "next" }, cookie, csrf));
    expect(r.headers.get("hx-redirect")).toBe("/");

    // Now the app is onboarded + branded
    const home = await app.request("/", { headers: { cookie }, redirect: "manual" });
    const html = await home.text();
    expect(home.status).toBe(200);
    expect(html).toContain("Acme Tunnels");
    expect(html).toContain("--brand-primary:#1d4ed8");
    // chrome: dark scheme, theme toggle, and the modal host for popups all ship
    expect(html).toContain('[data-theme="dark"]');
    expect(html).toContain('id="pb-theme-btn"');
    expect(html).toContain('id="pb-modal"');
  });

  test("skip advances without requiring input", async () => {
    const app = harness();
    const { cookie, csrf } = await login(app);
    const r = await app.request("/onboarding", form({ step: "0", action: "skip" }, cookie, csrf));
    expect(await r.text()).toContain("Branding essentials");
  });
});

describe("settings (parity)", () => {
  test("edits the same store; invalid colour is rejected", async () => {
    const app = harness();
    const { cookie, csrf } = await login(app);

    const ok = await app.request("/settings", form({ productName: "Rebrand Co", primary: "#1d4ed8" }, cookie, csrf));
    expect(ok.headers.get("hx-redirect")).toBe("/settings?saved=1");

    const page = await (await app.request("/settings?saved=1", { headers: { cookie } })).text();
    expect(page).toContain("Rebrand Co");
    expect(page).toContain("saved");

    const bad = await app.request("/settings", form({ primary: "not-a-color" }, cookie, csrf));
    expect(await bad.text()).toMatch(/valid hex/i);
  });
});
