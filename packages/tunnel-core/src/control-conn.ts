/**
 * Control connection: one long-lived WS to /agent/control (Bearer header).
 * Reconnects with exponential backoff + jitter; surfaces up/down transitions
 * and routes `opened`/`error`/`revoked`/`ping`. The client re-asserts desired
 * tunnels on each `up`.
 */

import {
  decodeControl,
  encodeControl,
  type ControlMessage,
  type OpenedMessage,
} from "@obsidiancode/portbridge-protocol";
import { connectWs, type WsClient } from "./ws.ts";
import { backoffDelay } from "./backoff.ts";

interface Pending {
  resolve: (m: OpenedMessage) => void;
  reject: (e: Error) => void;
}

export interface OpenRequest {
  targetId: string;
  targetPort: number;
  ttlMinutes: number | "never";
}

export class ControlConnection {
  private ws?: WsClient;
  private connected = false;
  private closing = false;
  private attempt = 0;
  private reqSeq = 0;
  private readonly pending = new Map<string, Pending>();
  private readonly upCbs: Array<() => void> = [];
  private readonly downCbs: Array<() => void> = [];
  private readonly waiters: Array<() => void> = [];
  private revokedCb?: (forwardId: string, reason: string) => void;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  onUp(cb: () => void): void {
    this.upCbs.push(cb);
  }
  onDown(cb: () => void): void {
    this.downCbs.push(cb);
  }
  onRevoked(cb: (forwardId: string, reason: string) => void): void {
    this.revokedCb = cb;
  }

  ensureConnected(): Promise<void> {
    if (this.connected) return Promise.resolve();
    this.connect();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private connect(): void {
    if (this.ws !== undefined || this.closing) return;
    const ws = connectWs(`${this.url}/agent/control`, { Authorization: `Bearer ${this.token}` });
    this.ws = ws;
    ws.onOpen(() => this.handleOpen());
    ws.onText((t) => this.handleText(t));
    ws.onClose(() => this.handleClose());
    ws.onError(() => undefined); // a close event follows; reconnect is driven there
  }

  private handleOpen(): void {
    this.connected = true;
    this.attempt = 0;
    this.waiters.splice(0).forEach((r) => r());
    this.upCbs.forEach((c) => c());
  }

  private handleClose(): void {
    const wasConnected = this.connected;
    this.ws = undefined;
    this.connected = false;
    this.pending.forEach((p) => p.reject(new Error("control connection lost")));
    this.pending.clear();
    if (wasConnected) this.downCbs.forEach((c) => c());
    if (!this.closing) setTimeout(() => this.connect(), backoffDelay(this.attempt++));
  }

  private handleText(text: string): void {
    let msg: ControlMessage;
    try {
      msg = decodeControl(text);
    } catch {
      return;
    }
    this.route(msg);
  }

  private route(msg: ControlMessage): void {
    if (msg.type === "opened" || msg.type === "error") {
      const pending = this.pending.get(msg.reqId);
      if (pending === undefined) return;
      this.pending.delete(msg.reqId);
      if (msg.type === "opened") pending.resolve(msg);
      else pending.reject(new Error(msg.message));
    } else if (msg.type === "revoked") {
      this.revokedCb?.(msg.forwardId, msg.reason);
    } else if (msg.type === "ping") {
      this.send({ type: "pong" });
    }
  }

  open(request: OpenRequest): Promise<OpenedMessage> {
    const reqId = `r${(this.reqSeq += 1)}`;
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      this.send({ type: "open", reqId, ...request });
    });
  }

  send(msg: ControlMessage): void {
    this.ws?.send(encodeControl(msg));
  }

  close(): void {
    this.closing = true;
    this.ws?.close();
    this.ws = undefined;
    this.connected = false;
  }
}
