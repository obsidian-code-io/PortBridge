/**
 * Client-side byte pipe: one local TCP socket ↔ one data WebSocket. Mirror of
 * the server pipe. Backpressure is bounded both ways:
 *  - local→WS: pause the local socket when ws.buffered() is high; a poller
 *    resumes it once the WS send buffer drains (the `ws` client has no drain
 *    event, so we poll).
 *  - WS→local: cap the local socket's write buffer and fail closed if the
 *    laptop app can't keep up.
 * Half-close: local FIN → WS close; WS close → local FIN.
 */

import type { Socket } from "node:net";
import type { WsClient } from "./ws.ts";

const HIGH_WATER = 1 * 1024 * 1024;
const LOW_WATER = 256 * 1024;
const MAX_SOCKET_BUFFER = 8 * 1024 * 1024;
const RESUME_POLL_MS = 20;

export class ClientPipe {
  private wsClosed = false;
  private socketClosed = false;
  private resumeTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly ws: WsClient,
    private readonly socket: Socket,
  ) {
    socket.on("data", (chunk: Buffer) => this.fromSocket(chunk));
    socket.on("end", () => this.closeWs());
    socket.on("error", () => this.destroy());
    socket.on("close", () => this.closeWs());
    ws.onBinary((data) => this.fromWs(data));
    ws.onClose(() => this.onWsClose());
    ws.onError(() => this.destroy());
  }

  /** Replay bytes read from the socket before this pipe was wired (in order). */
  prime(chunks: readonly Uint8Array[]): void {
    for (const chunk of chunks) this.fromSocket(chunk);
  }

  private fromSocket(chunk: Uint8Array): void {
    if (this.wsClosed) return;
    this.ws.send(chunk);
    if (this.ws.buffered() > HIGH_WATER) {
      this.socket.pause();
      this.scheduleResume();
    }
  }

  private scheduleResume(): void {
    if (this.resumeTimer !== undefined) return;
    this.resumeTimer = setInterval(() => {
      if (this.ws.buffered() < LOW_WATER || this.wsClosed) {
        this.socket.resume();
        this.clearResume();
      }
    }, RESUME_POLL_MS);
  }

  private fromWs(data: Uint8Array): void {
    if (this.socketClosed) return;
    if (!this.socket.write(data) && this.socket.writableLength > MAX_SOCKET_BUFFER) {
      this.destroy();
    }
  }

  private onWsClose(): void {
    this.wsClosed = true;
    this.clearResume();
    if (!this.socketClosed) this.socket.end();
  }

  private closeWs(): void {
    if (this.wsClosed) return;
    this.wsClosed = true;
    this.clearResume();
    this.ws.close();
  }

  private clearResume(): void {
    if (this.resumeTimer !== undefined) {
      clearInterval(this.resumeTimer);
      this.resumeTimer = undefined;
    }
  }

  private destroy(): void {
    if (!this.socketClosed) {
      this.socketClosed = true;
      this.socket.destroy();
    }
    this.closeWs();
  }
}
