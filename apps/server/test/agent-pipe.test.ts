import { afterAll, describe, expect, test } from "bun:test";
import { type AddressInfo, connect, createServer, type Server, type Socket } from "node:net";
import { StreamPipe, type WsSink } from "../src/agent/pipe.ts";

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

describe("StreamPipe", () => {
  test("pipes bytes both directions (WS→socket→echo→WS)", async () => {
    const port = await echoServer();
    const socket = await connectTo(port);
    const received: number[] = [];
    const sink: WsSink = { sendBinary: (d) => (received.push(...d), 0), close: () => undefined };
    const pipe = new StreamPipe(sink, socket);

    pipe.onWsMessage(new Uint8Array([1, 2, 3]));
    pipe.onWsMessage(new Uint8Array([4, 5]));
    await waitFor(() => received.length >= 5);
    expect(received).toEqual([1, 2, 3, 4, 5]);
    pipe.onWsClose();
  });

  test("pauses the target on WS backpressure and resumes on drain", async () => {
    const port = await echoServer();
    const socket = await connectTo(port);
    let paused = 0;
    let resumed = 0;
    const origPause = socket.pause.bind(socket);
    const origResume = socket.resume.bind(socket);
    socket.pause = () => (paused++, origPause());
    socket.resume = () => (resumed++, origResume());

    const sink: WsSink = { sendBinary: () => -1, close: () => undefined }; // always backpressured
    const pipe = new StreamPipe(sink, socket);
    pipe.onWsMessage(new Uint8Array([9, 9, 9])); // echoed back → fromSocket → send()=-1 → pause

    await waitFor(() => paused > 0);
    expect(paused).toBeGreaterThan(0);
    pipe.onDrain();
    expect(resumed).toBeGreaterThan(0);
    pipe.onWsClose();
  });

  test("half-close: WS close ends the target socket (FIN)", async () => {
    let sawEnd = false;
    const server = createServer((sock) => sock.on("end", () => (sawEnd = true)));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;

    const socket = await connectTo(port);
    const pipe = new StreamPipe({ sendBinary: () => 0, close: () => undefined }, socket);
    pipe.onWsClose();
    await waitFor(() => sawEnd);
    expect(sawEnd).toBe(true);
  });

  test("target FIN closes the WS", async () => {
    const server = createServer((sock) => sock.end()); // immediately FIN
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;

    const socket = await connectTo(port);
    let closedCode: number | undefined;
    const pipe = new StreamPipe({ sendBinary: () => 0, close: (c) => (closedCode = c) }, socket);
    void pipe;
    await waitFor(() => closedCode !== undefined);
    expect(closedCode).toBe(1000);
  });
});
