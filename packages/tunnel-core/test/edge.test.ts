import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { createClient } from "../src/index.ts";

let servers: Server[] = [];
afterEach(() => {
  servers.forEach((s) => s.close());
  servers = [];
});

async function rejectingServer(): Promise<string> {
  const http = createServer((_q, r) => r.writeHead(401).end());
  http.on("upgrade", (_req, socket) => {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
  });
  servers.push(http);
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}

describe("first-run edge cases (no hangs)", () => {
  test("bad token: openTunnel rejects promptly instead of reconnecting forever", async () => {
    const url = await rejectingServer();
    const client = createClient({ url, token: "wrong" });
    await expect(client.openTunnel({ targetId: "c1", targetPort: 5432 })).rejects.toThrow();
    client.close();
  });

  test("unreachable server: openTunnel rejects promptly", async () => {
    // Nothing is listening on this port.
    const client = createClient({ url: "http://127.0.0.1:1", token: "t" });
    await expect(client.openTunnel({ targetId: "c1", targetPort: 5432 })).rejects.toThrow();
    client.close();
  });

  test("bad token: targets() gives a clear unauthorized error", async () => {
    const url = await rejectingServer();
    const client = createClient({ url, token: "wrong" });
    await expect(client.targets()).rejects.toThrow(/unauthorized|401/i);
    client.close();
  });

  test("unreachable server: targets() gives a clear reachability error", async () => {
    const client = createClient({ url: "http://127.0.0.1:1", token: "t" });
    await expect(client.targets()).rejects.toThrow(/could not reach/i);
    client.close();
  });
});
