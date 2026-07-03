/**
 * Bidirectional byte pipe: one data WebSocket ↔ one target TCP socket.
 *
 * Backpressure (both directions bounded — the thing naive tunnels get wrong):
 *  - target → WS: Bun's ws.send() returns -1 under backpressure; we pause the
 *    target socket and resume it from the WS `drain` callback. This is what
 *    stops a slow local consumer from growing server memory unbounded.
 *  - WS → target: node's socket.write() returns false when its buffer fills;
 *    Bun gives no way to pause WS receive, so we cap the socket's write buffer
 *    and fail closed if the target can't keep up (bounded, never unbounded).
 *
 * Half-close: target FIN → WS close; WS close → target FIN; errors tear down both.
 */

import type { Socket } from "node:net";

/** The WS surface the pipe needs. `sendBinary` returns Bun's send status. */
export interface WsSink {
  sendBinary(data: Uint8Array): number;
  close(code?: number, reason?: string): void;
}

const MAX_SOCKET_BUFFER = 8 * 1024 * 1024; // 8 MB cap for the WS→target direction
const BACKPRESSURE = -1;

export class StreamPipe {
  private wsClosed = false;
  private socketClosed = false;

  constructor(
    private readonly ws: WsSink,
    private readonly socket: Socket,
  ) {
    socket.on("data", (chunk: Buffer) => this.fromSocket(chunk));
    socket.on("end", () => this.closeWs(1000, "target closed"));
    socket.on("error", () => this.destroy());
    socket.on("close", () => this.closeWs(1000, "target closed"));
  }

  private fromSocket(chunk: Buffer): void {
    if (this.wsClosed) return;
    if (this.ws.sendBinary(chunk) === BACKPRESSURE) this.socket.pause();
  }

  /** A binary frame arrived from the client. */
  onWsMessage(data: Uint8Array): void {
    if (this.socketClosed) return;
    if (!this.socket.write(data) && this.socket.writableLength > MAX_SOCKET_BUFFER) {
      this.destroy();
    }
  }

  /** The WS drained — resume reading from the target. */
  onDrain(): void {
    if (!this.socketClosed) this.socket.resume();
  }

  /** The client's data WS closed — half-close the target. */
  onWsClose(): void {
    this.wsClosed = true;
    if (!this.socketClosed) this.socket.end();
  }

  private closeWs(code: number, reason: string): void {
    if (this.wsClosed) return;
    this.wsClosed = true;
    this.ws.close(code, reason);
  }

  private destroy(): void {
    if (!this.socketClosed) {
      this.socketClosed = true;
      this.socket.destroy();
    }
    this.closeWs(1011, "pipe error");
  }
}

// --- WS drain routing --------------------------------------------------------
// Hono's WSEvents don't surface Bun's `drain`, so the composed websocket handler
// (agent/websocket.ts) calls handleDrain(rawWs); we route it to the pipe here.

const drainHandlers = new WeakMap<object, () => void>();

export function registerDrain(rawWs: object, handler: () => void): void {
  drainHandlers.set(rawWs, handler);
}

export function unregisterDrain(rawWs: object): void {
  drainHandlers.delete(rawWs);
}

export function handleDrain(rawWs: object): void {
  drainHandlers.get(rawWs)?.();
}
