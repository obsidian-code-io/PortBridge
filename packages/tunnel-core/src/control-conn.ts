/**
 * Control connection: one long-lived WS to /agent/control (Bearer header).
 *
 * Failure handling is first-run-aware:
 *  - a rejected upgrade (401/403) is FATAL — we don't reconnect; the pending
 *    open/ensureConnected reject with a clear "check the URL and token" error;
 *  - the FIRST connect attempt failing (bad host, refused, timeout) also fails
 *    fast rather than silently spinning a reconnect loop forever;
 *  - only AFTER a successful connect do drops trigger reconnect with backoff +
 *    jitter (laptop sleep / server restart), and the client re-asserts tunnels.
 */

import {
  decodeControl,
  encodeControl,
  type ControlMessage,
  type OpenedMessage,
} from "@obsidiancode/portbridge-protocol";
import { connectWs, type WsClient, type WsError } from "./ws.ts";
import { backoffDelay } from "./backoff.ts";

const CONNECT_TIMEOUT_MS = 10_000;
const OPEN_TIMEOUT_MS = 15_000;

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

export interface OpenRequest {
  targetId: string;
  targetPort: number;
  ttlMinutes: number | "never";
}

export class ControlConnection {
  private ws?: WsClient;
  private connected = false;
  private everConnected = false;
  private closing = false;
  private attempt = 0;
  private reqSeq = 0;
  private fatalErr?: Error;
  private lastError?: Error;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private readonly pending = new Map<string, Deferred<OpenedMessage>>();
  private readonly upCbs: Array<() => void> = [];
  private readonly downCbs: Array<() => void> = [];
  private waiters: Array<Deferred<void>> = [];
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
    if (this.fatalErr !== undefined) return Promise.reject(this.fatalErr);
    if (this.connected) return Promise.resolve();
    this.connect();
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private connect(): void {
    if (this.ws !== undefined || this.closing) return;
    const ws = connectWs(`${this.url}/agent/control`, { Authorization: `Bearer ${this.token}` });
    this.ws = ws;
    this.connectTimer = setTimeout(() => this.onConnectTimeout(), CONNECT_TIMEOUT_MS);
    ws.onOpen(() => this.handleOpen());
    ws.onText((t) => this.handleText(t));
    ws.onClose(() => this.teardown());
    ws.onError((e) => this.handleError(e));
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== undefined) {
      clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
    }
  }

  private onConnectTimeout(): void {
    this.lastError = new Error(`timed out connecting to ${this.url}`);
    this.teardown();
  }

  private handleError(err: WsError): void {
    this.lastError = err;
    if (err.status === 401 || err.status === 403) {
      this.fatalErr = new Error(`server rejected authentication (HTTP ${err.status}) — check the URL and admin token`);
    }
    this.teardown();
  }

  private handleOpen(): void {
    this.clearConnectTimer();
    this.connected = true;
    this.everConnected = true;
    this.attempt = 0;
    this.waiters.splice(0).forEach((w) => w.resolve());
    this.upCbs.forEach((c) => c());
  }

  /** Runs once per ws instance (guarded on this.ws). Reconnects only when safe. */
  private teardown(): void {
    if (this.ws === undefined) return;
    this.clearConnectTimer();
    const wasConnected = this.connected;
    this.ws = undefined;
    this.connected = false;
    const err = this.fatalErr ?? this.lastError ?? new Error("control connection lost");
    this.pending.forEach((p) => p.reject(err));
    this.pending.clear();
    if (this.fatalErr !== undefined || !this.everConnected) {
      this.closing = true; // bad token / never established — fail fast, don't spin
      this.waiters.splice(0).forEach((w) => w.reject(err));
    }
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
      const timer = setTimeout(() => {
        if (this.pending.delete(reqId)) reject(new Error("timed out waiting for the server to open the tunnel"));
      }, OPEN_TIMEOUT_MS);
      this.pending.set(reqId, {
        resolve: (m) => (clearTimeout(timer), resolve(m)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.send({ type: "open", reqId, ...request });
    });
  }

  send(msg: ControlMessage): void {
    this.ws?.send(encodeControl(msg));
  }

  close(): void {
    this.closing = true;
    this.clearConnectTimer();
    this.ws?.close();
    this.ws = undefined;
    this.connected = false;
  }
}
