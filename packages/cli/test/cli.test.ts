import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import {
  clearConfig,
  configPath,
  readConfig,
  resolveToken,
  resolveUrl,
  writeConfig,
} from "../src/config.ts";
import { cmdConfig, cmdLs, cmdTargets } from "../src/commands.ts";

let home: string;
let savedHome: string | undefined;
let savedUrl: string | undefined;
let savedToken: string | undefined;

beforeEach(() => {
  savedHome = process.env["HOME"];
  savedUrl = process.env["PORTBRIDGE_URL"];
  savedToken = process.env["PORTBRIDGE_TOKEN"];
  home = mkdtempSync(join(tmpdir(), "pb-cli-"));
  process.env["HOME"] = home;
  delete process.env["PORTBRIDGE_URL"];
  delete process.env["PORTBRIDGE_TOKEN"];
});

afterEach(() => {
  process.env["HOME"] = savedHome;
  if (savedUrl === undefined) delete process.env["PORTBRIDGE_URL"];
  else process.env["PORTBRIDGE_URL"] = savedUrl;
  if (savedToken === undefined) delete process.env["PORTBRIDGE_TOKEN"];
  else process.env["PORTBRIDGE_TOKEN"] = savedToken;
  rmSync(home, { recursive: true, force: true });
});

function captureLog(fn: () => void | Promise<void>): Promise<string> {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  return Promise.resolve(fn()).finally(() => (console.log = orig)).then(() => lines.join("\n"));
}

describe("config storage", () => {
  test("writeConfig persists and enforces 0600 perms", () => {
    writeConfig({ url: "https://pb.example", token: "secret" });
    expect(readConfig()).toEqual({ url: "https://pb.example", token: "secret" });
    const mode = statSync(configPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("clearConfig removes the file", () => {
    writeConfig({ url: "x", token: "y" });
    clearConfig();
    expect(readConfig()).toEqual({});
  });

  test("config set-url stores a trimmed URL; show never prints the token", async () => {
    cmdConfig("set-url", "https://pb.example/");
    expect(readConfig().url).toBe("https://pb.example");
    writeConfig({ ...readConfig(), token: "supersecret" });
    const out = await captureLog(() => cmdConfig("show"));
    expect(out).toContain("token:    set");
    expect(out).not.toContain("supersecret");
  });
});

describe("url/token resolution precedence", () => {
  test("--url flag beats env beats config", () => {
    writeConfig({ url: "https://from-config" });
    process.env["PORTBRIDGE_URL"] = "https://from-env";
    expect(resolveUrl("https://from-flag")).toBe("https://from-flag");
    expect(resolveUrl()).toBe("https://from-env");
    delete process.env["PORTBRIDGE_URL"];
    expect(resolveUrl()).toBe("https://from-config");
  });

  test("resolveUrl / resolveToken fail closed with a clear message", () => {
    expect(() => resolveUrl()).toThrow(/server URL/i);
    expect(() => resolveToken()).toThrow(/logged in/i);
  });
});

describe("API-backed commands", () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url === "/api/targets") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([{ id: "abc123", name: "web", image: "nginx", state: "running", ports: [{ port: 80, protocol: "tcp", published: false }] }]));
      } else if (req.url === "/api/forwards") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([
          { id: "tun-1", kind: "agent-tunnel", targetName: "db", targetId: "d1", targetPort: 5432, hostPort: null, network: "bridge", createdAt: 1, expiresAt: "never", createdBy: "admin" },
          { id: "tcp-1", kind: "tcp", targetName: "web", targetId: "w1", targetPort: 80, hostPort: 30000, network: "bridge", createdAt: 1, expiresAt: "never", createdBy: "admin" },
        ]));
      } else res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env["PORTBRIDGE_URL"] = base;
    process.env["PORTBRIDGE_TOKEN"] = "tok";
  });

  afterEach(() => server.close());

  test("targets prints the container table", async () => {
    const out = await captureLog(() => cmdTargets({}));
    expect(out).toContain("web");
    expect(out).toContain("nginx");
    expect(out).toContain("80");
  });

  test("ls shows only agent-tunnels (not tcp forwards)", async () => {
    const out = await captureLog(() => cmdLs({}));
    expect(out).toContain("db:5432");
    expect(out).not.toContain("web:80");
  });
});
