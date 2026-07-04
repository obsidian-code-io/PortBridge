import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Docker from "dockerode";
import type { Config } from "../src/config.ts";
import type { AuditReader, AuditWriter } from "../src/audit/types.ts";
import { createApp } from "../src/web/app.ts";
import { BrandStore } from "../src/brand/store.ts";

const TOKEN = "0123456789abcdef0123";
const NET = "app-net";
process.env.HOSTNAME = "selfid"; // so getSelfId() excludes the PortBridge container itself
let dirs: string[] = [];
afterEach(() => { dirs.forEach((d) => rmSync(d, { recursive: true, force: true })); dirs = []; });

interface Sample { id: string; name: string; port: number; }
const TARGETS: Sample[] = [
  { id: "pg7f3a2b1c9d", name: "postgres", port: 5432 },
  { id: "rd8e2c1a4b5f", name: "redis", port: 6379 },
];
const sidecars: Array<{ Id: string; Labels: Record<string, string> }> = [];

function inspectOf(t: Sample) {
  return {
    Id: t.id + "0000", Name: "/" + t.name,
    Config: { Image: t.name + ":latest", Labels: {}, ExposedPorts: { [`${t.port}/tcp`]: {} } },
    State: { Status: "running" },
    NetworkSettings: { Networks: { [NET]: { IPAddress: "10.0.0.2" } }, Ports: {} },
  };
}

function fakeDocker(): Docker {
  return {
    ping: async () => "OK",
    listContainers: async (o?: { filters?: { label?: string[] } }) => {
      if (o?.filters?.label) return sidecars;
      return [...TARGETS.map((t) => ({ Id: t.id + "0000", Labels: {} })), { Id: "selfid", Labels: {} }];
    },
    getContainer: (id: string) => ({
      inspect: async () => {
        if (id.startsWith("self")) return { Id: "selfid", Config: { Labels: {} }, NetworkSettings: { Networks: { [NET]: {} } } };
        const t = TARGETS.find((x) => id.startsWith(x.id));
        if (t) return inspectOf(t);
        throw Object.assign(new Error("no such container"), { statusCode: 404 });
      },
      remove: async () => undefined, logs: async () => Buffer.from(""), start: async () => undefined,
    }),
    getImage: () => ({ inspect: async () => ({}) }),
    getNetwork: () => ({ inspect: async () => ({ Driver: "bridge" }) }),
    createContainer: async (opts: Record<string, unknown>) => {
      sidecars.push({ Id: String(opts["name"]), Labels: opts["Labels"] as Record<string, string> });
      return { start: async () => undefined };
    },
  } as unknown as Docker;
}

function harness() {
  const dataDir = mkdtempSync(join(tmpdir(), "pb-enf-"));
  dirs.push(dataDir);
  new BrandStore(dataDir).setOnboarding({ onboarded: true });
  const config: Config = {
    adminToken: TOKEN, port: 8080, portRange: { start: 30000, end: 30999 }, defaultTtlMinutes: 60,
    maxForwards: 50, socatImage: "x", dockerHost: undefined, dataDir,
  };
  const audit: AuditWriter & AuditReader = { write: () => undefined, query: () => [] };
  return createApp(fakeDocker(), config, audit, audit).app;
}
type App = ReturnType<typeof harness>;

const admin = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
async function post(app: App, path: string, body: unknown, headers: Record<string, string>) {
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
}

async function makeScopedKey(app: App): Promise<string> {
  const roleRes = await post(app, "/api/roles", { name: "db", allPorts: false, ports: [5432], allContainers: true }, admin);
  const roleId = (await roleRes.json()).id as string;
  const keyRes = await post(app, "/api/keys", { label: "alice", roleId }, admin);
  return (await keyRes.json()).key as string;
}

describe("roles/keys management API", () => {
  test("admin creates a role + key; the key is returned once", async () => {
    const app = harness();
    const key = await makeScopedKey(app);
    expect(key.startsWith("pbk_")).toBe(true);
    const list = await (await app.request("/api/keys", { headers: admin })).json();
    expect(list[0].label).toBe("alice");
    expect(JSON.stringify(list)).not.toContain(key); // secret never listed
  });

  test("a keyed user cannot mint roles or keys", async () => {
    const app = harness();
    const key = await makeScopedKey(app);
    const asUser = { authorization: `Bearer ${key}`, "content-type": "application/json" };
    expect((await post(app, "/api/roles", { name: "x", allPorts: true }, asUser)).status).toBe(403);
    expect((await post(app, "/api/keys", { label: "y", roleId: "z" }, asUser)).status).toBe(403);
  });
});

describe("API enforcement", () => {
  test("targets are filtered and out-of-scope create is refused", async () => {
    const app = harness();
    const key = await makeScopedKey(app);
    const asUser = { authorization: `Bearer ${key}` };

    const targets = await (await app.request("/api/targets", { headers: asUser })).json();
    expect(targets.map((t: { name: string }) => t.name)).toEqual(["postgres"]); // redis (6379) hidden

    const redis = TARGETS[1]!;
    const denied = await post(app, "/api/forwards", { targetId: redis.id, targetPort: 6379 },
      { ...asUser, "content-type": "application/json" });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toMatch(/port 6379/);

    // in-scope create passes the scope check
    const pg = TARGETS[0]!;
    const ok = await post(app, "/api/forwards", { targetId: pg.id, targetPort: 5432 },
      { ...asUser, "content-type": "application/json" });
    expect(ok.status).not.toBe(403);
  });

  test("admin bearer is unrestricted", async () => {
    const app = harness();
    const targets = await (await app.request("/api/targets", { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    expect(targets.map((t: { name: string }) => t.name).sort()).toEqual(["postgres", "redis"]);
  });
});

describe("web login + dashboard scoping", () => {
  test("a user logs in with their key and sees only allowed targets", async () => {
    const app = harness();
    const key = await makeScopedKey(app);
    const login = await app.request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: key }).toString(),
    });
    expect(login.status).toBe(302);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const home = await app.request("/", { headers: { cookie } });
    const html = await home.text();
    expect(home.status).toBe(200);
    expect(html).toContain("postgres");
    expect(html).not.toContain("redis");
  });
});
