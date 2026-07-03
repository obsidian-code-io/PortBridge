import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { type AddressInfo, createServer, type Server as NetServer } from "node:net";
import type Docker from "dockerode";
import type { Config } from "../src/config.ts";
import type { AuditEvent, AuditWriter } from "../src/audit/types.ts";
import { agentRoutes } from "../src/agent/routes.ts";
import { agentWebsocket } from "../src/agent/websocket.ts";
import { TunnelRegistry } from "../src/agent/registry.ts";

const TOKEN = "0123456789abcdef0123";

function makeConfig(maxForwards: number): Config {
  return {
    adminToken: TOKEN, port: 8080, portRange: { start: 30000, end: 30999 },
    defaultTtlMinutes: 60, maxForwards, socatImage: "alpine/socat:test",
    dockerHost: undefined, dataDir: "/tmp",
  };
}

function managedSidecar(i: number) {
  return {
    Id: `s${i}`,
    Labels: {
      "portbridge.managed": "true", "portbridge.id": `s${i}`,
      "portbridge.target.port": "1", "portbridge.host.port": String(40000 + i), "portbridge.created.at": "1",
    },
  };
}

function fakeDocker(tcpCount: number): Docker {
  const managed = Array.from({ length: tcpCount }, (_, i) => managedSidecar(i));
  return {
    ping: async () => "OK",
    listContainers: async () => managed,
    getContainer: (id: string) => ({
      // Docker resolves id prefixes; the registry re-dials with the short id.
      inspect: async () => {
        if (id.startsWith("selfhost")) return { Id: "selfhost-id", NetworkSettings: { Networks: { bridge: {} } }, Config: { Labels: {} } };
        if (id.startsWith("target1")) return { Id: "target1-id", Name: "/echo", Config: { Labels: {} }, NetworkSettings: { Networks: { bridge: { IPAddress: "127.0.0.1" } } } };
        throw Object.assign(new Error("nf"), { statusCode: 404 });
      },
    }),
  } as unknown as Docker;
}

interface Harness {
  port: number;
  registry: TunnelRegistry;
  events: AuditEvent[];
  stop: () => void;
}

const started: Array<() => void> = [];
let echoPort = 0;
let echo: NetServer;

beforeAll(async () => {
  process.env.HOSTNAME = "selfhost";
  echo = createServer((sock) => sock.pipe(sock));
  await new Promise<void>((r) => echo.listen(0, "127.0.0.1", () => r()));
  echoPort = (echo.address() as AddressInfo).port;
});

afterAll(() => {
  started.forEach((s) => s());
  echo.close();
});

function startServer(maxForwards = 50, tcpCount = 0): Harness {
  const events: AuditEvent[] = [];
  const audit: AuditWriter = { write: (e) => events.push(e) };
  const registry = new TunnelRegistry(60);
  const app = new Hono();
  app.route("/", agentRoutes(fakeDocker(tcpCount), makeConfig(maxForwards), audit, registry));
  const server = Bun.serve({ port: 0, fetch: app.fetch, websocket: agentWebsocket });
  const stop = () => server.stop(true);
  started.push(stop);
  return { port: server.port, registry, events, stop };
}

function controlWs(port: number, token: string, origin?: string): WebSocket {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (origin !== undefined) headers["Origin"] = origin;
  return new WebSocket(`ws://127.0.0.1:${port}/agent/control`, { headers } as unknown as string[]);
}

function connectOutcome(ws: WebSocket): Promise<"opened" | "rejected"> {
  return new Promise((resolve) => {
    ws.onopen = () => resolve("opened");
    ws.onerror = () => resolve("rejected");
    ws.onclose = () => resolve("rejected");
  });
}

interface OpenResult {
  ws: WebSocket;
  forwardId: string;
  streamToken: string;
  onMessage: (fn: (m: Record<string, unknown>) => void) => void;
}

function openTunnel(port: number, targetId: string, targetPort: number): Promise<OpenResult> {
  return new Promise((resolve, reject) => {
    const ws = controlWs(port, TOKEN);
    let extra: ((m: Record<string, unknown>) => void) | undefined;
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as Record<string, unknown>;
      if (m["type"] === "opened") {
        resolve({ ws, forwardId: String(m["forwardId"]), streamToken: String(m["streamToken"]), onMessage: (fn) => (extra = fn) });
      } else if (m["type"] === "error") reject(new Error(String(m["message"])));
      else extra?.(m);
    };
    ws.onerror = () => reject(new Error("control error"));
    ws.onopen = () => ws.send(JSON.stringify({ type: "open", reqId: "r1", targetId, targetPort, ttlMinutes: 60 }));
  });
}

function streamEcho(port: number, forwardId: string, streamToken: string, payload: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/stream`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      ws.send(JSON.stringify({ forwardId, streamToken }));
      ws.send(payload); // early binary — exercises the server's handshake queue
    };
    ws.onmessage = (e) => {
      resolve(new Uint8Array(e.data as ArrayBuffer));
      ws.close();
    };
    ws.onclose = (e) => reject(new Error(`stream closed ${e.code} ${e.reason}`));
  });
}

describe("agent-tunnel end to end", () => {
  test("control channel rejects a wrong Bearer token", async () => {
    const h = startServer();
    expect(await connectOutcome(controlWs(h.port, "wrong-token"))).toBe("rejected");
  });

  test("control channel rejects an upgrade carrying an Origin (browser-unreachable)", async () => {
    const h = startServer();
    expect(await connectOutcome(controlWs(h.port, TOKEN, "http://evil.example"))).toBe("rejected");
  });

  test("open → opened, then a data stream round-trips bytes through the target", async () => {
    const h = startServer();
    const { ws, forwardId, streamToken } = await openTunnel(h.port, "target1", echoPort);
    expect(h.registry.size()).toBe(1);
    const echoed = await streamEcho(h.port, forwardId, streamToken, new Uint8Array([7, 8, 9, 10]));
    expect([...echoed]).toEqual([7, 8, 9, 10]);
    expect(h.events.some((e) => e.action === "tunnel_opened")).toBe(true);
    ws.close();
  });

  test("a data stream with a bad token is rejected (policy close)", async () => {
    const h = startServer();
    const { ws, forwardId } = await openTunnel(h.port, "target1", echoPort);
    await expect(streamEcho(h.port, forwardId, "bogus-token", new Uint8Array([1]))).rejects.toThrow(/1008|closed/);
    ws.close();
  });

  test("SSRF: open to an unknown container returns an error, no tunnel created", async () => {
    const h = startServer();
    await expect(openTunnel(h.port, "ghost", echoPort)).rejects.toThrow();
    expect(h.registry.size()).toBe(0);
  });

  test("shared MAX_FORWARDS counts tunnels", async () => {
    const h = startServer(1);
    const first = await openTunnel(h.port, "target1", echoPort);
    expect(h.registry.size()).toBe(1);
    await expect(openTunnel(h.port, "target1", echoPort)).rejects.toThrow(/MAX_FORWARDS/);
    first.ws.close();
  });

  test("shared MAX_FORWARDS counts existing tcp sidecars too", async () => {
    const h = startServer(1, 1); // cap 1, already one tcp sidecar
    await expect(openTunnel(h.port, "target1", echoPort)).rejects.toThrow(/MAX_FORWARDS/);
    expect(h.registry.size()).toBe(0);
  });

  test("server-side revoke reaches the control client and drops the tunnel", async () => {
    const h = startServer();
    const opened = await openTunnel(h.port, "target1", echoPort);
    const revoked = new Promise<Record<string, unknown>>((resolve) => opened.onMessage((m) => {
      if (m["type"] === "revoked") resolve(m);
    }));
    h.registry.close(opened.forwardId, "ui");
    const msg = await revoked;
    expect(msg["reason"]).toBe("ui");
    expect(h.registry.size()).toBe(0);
    opened.ws.close();
  });
});
