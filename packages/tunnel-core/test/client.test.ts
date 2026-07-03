import { afterEach, describe, expect, test } from "bun:test";
import { createServer as httpServer, type Server as HttpServer } from "node:http";
import { type AddressInfo, connect, type Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { createClient } from "../src/index.ts";

const TOKEN = "T-secret";

interface Mock {
  url: string;
  http: HttpServer;
  revoke: (forwardId: string, reason: string) => void;
  dropControls: () => void;
}

function startMock(): Promise<Mock> {
  const tokens = new Map<string, string>();
  const controls = new Set<WebSocket>();
  let seq = 0;
  const http = httpServer((req, res) => {
    if (req.url === "/api/targets") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([{ id: "c1", name: "web", image: "nginx", state: "running", ports: [] }]));
      return;
    }
    res.writeHead(404).end();
  });
  const control = new WebSocketServer({ noServer: true });
  const stream = new WebSocketServer({ noServer: true });

  http.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/agent/control") {
      if (req.headers["authorization"] !== `Bearer ${TOKEN}`) return void socket.destroy();
      control.handleUpgrade(req, socket, head, (ws) => control.emit("connection", ws));
    } else if (path === "/agent/stream") {
      stream.handleUpgrade(req, socket, head, (ws) => stream.emit("connection", ws));
    } else socket.destroy();
  });

  control.on("connection", (ws) => {
    controls.add(ws);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg["type"] === "open") {
        const forwardId = `f${(seq += 1)}`;
        const streamToken = `tok-${seq}-0123456789abcdef0123456789abcdef`;
        tokens.set(forwardId, streamToken);
        ws.send(JSON.stringify({ type: "opened", reqId: msg["reqId"], forwardId, streamToken }));
      } else if (msg["type"] === "close") tokens.delete(String(msg["forwardId"]));
      else if (msg["type"] === "ping") ws.send(JSON.stringify({ type: "pong" }));
    });
    ws.on("close", () => controls.delete(ws));
  });

  stream.on("connection", (ws) => {
    ws.binaryType = "nodebuffer";
    let authed = false;
    ws.on("message", (data, isBinary) => {
      if (!authed) {
        const hs = JSON.parse(data.toString()) as { forwardId: string; streamToken: string };
        if (tokens.get(hs.forwardId) !== hs.streamToken) return void ws.close(1008, "bad token");
        authed = true;
        return;
      }
      ws.send(data, { binary: isBinary }); // echo target
    });
  });

  return new Promise((resolve) =>
    http.listen(0, "127.0.0.1", () => {
      const port = (http.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        http,
        revoke: (forwardId, reason) => controls.forEach((c) => c.send(JSON.stringify({ type: "revoked", forwardId, reason }))),
        dropControls: () => controls.forEach((c) => c.close()),
      });
    }),
  );
}

async function roundtrip(localPort: number, bytes: number[]): Promise<number[]> {
  const sock = connect({ host: "127.0.0.1", port: localPort });
  await new Promise<void>((r) => sock.on("connect", () => r()));
  const got: number[] = [];
  sock.on("data", (d) => got.push(...d));
  sock.write(Buffer.from(bytes));
  await waitFor(() => got.length >= bytes.length);
  sock.destroy();
  return got;
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Bun.nanoseconds();
  while (!cond()) {
    if ((Bun.nanoseconds() - start) / 1e6 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

let cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.forEach((c) => c());
  cleanup = [];
});

describe("tunnel-core client", () => {
  test("targets() fetches the JSON API with the bearer token", async () => {
    const mock = await startMock();
    cleanup.push(() => mock.http.close());
    const client = createClient({ url: mock.url, token: TOKEN });
    cleanup.push(() => client.close());
    const targets = await client.targets();
    expect(targets.map((t) => t.name)).toEqual(["web"]);
  });

  test("openTunnel binds a local port and round-trips bytes", async () => {
    const mock = await startMock();
    cleanup.push(() => mock.http.close());
    const client = createClient({ url: mock.url, token: TOKEN });
    cleanup.push(() => client.close());

    const tunnel = await client.openTunnel({ targetId: "c1", targetPort: 5432 });
    expect(tunnel.localPort).toBeGreaterThan(0);
    expect(await roundtrip(tunnel.localPort!, [1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  test("a server-side revoke fires the tunnel's revoked event", async () => {
    const mock = await startMock();
    cleanup.push(() => mock.http.close());
    const client = createClient({ url: mock.url, token: TOKEN });
    cleanup.push(() => client.close());

    const tunnel = await client.openTunnel({ targetId: "c1", targetPort: 5432 });
    const revoked = new Promise<string>((resolve) => tunnel.on("revoked", (e: { reason: string }) => resolve(e.reason)));
    mock.revoke(tunnel.forwardId!, "ttl");
    expect(await revoked).toBe("ttl");
  });

  test("reconnects and re-asserts the tunnel after control loss", async () => {
    const mock = await startMock();
    cleanup.push(() => mock.http.close());
    const client = createClient({ url: mock.url, token: TOKEN });
    cleanup.push(() => client.close());

    const tunnel = await client.openTunnel({ targetId: "c1", targetPort: 5432 });
    const port = tunnel.localPort!;
    const firstForward = tunnel.forwardId;

    const reready = new Promise<void>((resolve) => tunnel.once("ready", () => resolve()));
    mock.dropControls(); // kill the control connection
    await reready; // client reconnected + re-opened

    expect(tunnel.forwardId).not.toBe(firstForward); // fresh forward on reconnect
    expect(tunnel.localPort).toBe(port); // stable local port
    expect(await roundtrip(port, [7, 8, 9])).toEqual([7, 8, 9]);
  });
});
