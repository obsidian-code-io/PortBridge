import { afterAll, describe, expect, test } from "bun:test";
import { type AddressInfo, connect, createServer, type Server, type Socket } from "node:net";
import { ClientPipe } from "../src/pipe.ts";
import type { WsClient } from "../src/ws.ts";

const servers: Server[] = [];
afterAll(() => servers.forEach((s) => s.close()));

async function echoServer(): Promise<number> {
  const server = createServer((sock) => sock.pipe(sock));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return (server.address() as AddressInfo).port;
}

async function connectTo(port: number): Promise<Socket> {
  const socket = connect({ host: "127.0.0.1", port });
  await new Promise<void>((r) => socket.on("connect", () => r()));
  return socket;
}

async function waitFor(cond: () => boolean, ms = 1000): Promise<void> {
  const start = Bun.nanoseconds();
  while (!cond()) {
    if ((Bun.nanoseconds() - start) / 1e6 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** A minimal in-memory WsClient whose binary sends can be observed + gated. */
function fakeWs(buffered: () => number) {
  let onBin: ((d: Uint8Array) => void) | undefined;
  const sent: number[] = [];
  return {
    ws: {
      send: (d: string | Uint8Array) => { if (typeof d !== "string") sent.push(...d); },
      close: () => undefined,
      buffered,
      onOpen: () => undefined,
      onText: () => undefined,
      onBinary: (cb) => (onBin = cb),
      onClose: () => undefined,
      onError: () => undefined,
    } as WsClient,
    sent,
    deliver: (d: Uint8Array) => onBin?.(d),
  };
}

describe("ClientPipe", () => {
  test("pipes local socket bytes to the WS and delivers WS bytes to the socket", async () => {
    const port = await echoServer();
    const socket = await connectTo(port);
    const fake = fakeWs(() => 0);
    new ClientPipe(fake.ws, socket);

    socket.write(Buffer.from([5, 6, 7])); // will echo → socket 'data' → ws.send
    await waitFor(() => fake.sent.length >= 3);
    expect(fake.sent).toEqual([5, 6, 7]);

    const got: number[] = [];
    socket.on("data", (d) => got.push(...d));
    fake.deliver(new Uint8Array([9, 9])); // WS → socket.write → echo → socket 'data'
    await waitFor(() => got.length >= 2);
    expect(got).toEqual([9, 9]);
    socket.destroy();
  });

  test("pauses the local socket when the WS send buffer is high, resumes on drain", async () => {
    const port = await echoServer();
    const socket = await connectTo(port);
    let paused = 0;
    let resumed = 0;
    const origPause = socket.pause.bind(socket);
    const origResume = socket.resume.bind(socket);
    socket.pause = () => (paused++, origPause());
    socket.resume = () => (resumed++, origResume());

    let high = true;
    new ClientPipe(fakeWs(() => (high ? 5_000_000 : 0)).ws, socket);
    socket.write(Buffer.from([1])); // echoed → fromSocket → buffered high → pause
    await waitFor(() => paused > 0);
    expect(paused).toBeGreaterThan(0);
    high = false; // buffer drains → poller resumes
    await waitFor(() => resumed > 0);
    expect(resumed).toBeGreaterThan(0);
    socket.destroy();
  });
});
