/**
 * Thin WebSocket client wrapper over the `ws` package (works under Bun and
 * Node, and — unlike the WHATWG WebSocket on Node — can set the Authorization
 * header the control channel requires). Exposes just what the client needs.
 */

import { WebSocket, type RawData } from "ws";

export interface WsClient {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  /** Bytes queued but not yet flushed — used for send-side backpressure. */
  buffered(): number;
  onOpen(cb: () => void): void;
  onText(cb: (text: string) => void): void;
  onBinary(cb: (data: Uint8Array) => void): void;
  onClose(cb: (code: number, reason: string) => void): void;
  onError(cb: (err: Error) => void): void;
}

function toUint8(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data);
}

export function connectWs(httpUrl: string, headers?: Record<string, string>): WsClient {
  const wsUrl = httpUrl.replace(/^http/, "ws");
  const ws = new WebSocket(wsUrl, headers ? { headers } : undefined);
  ws.binaryType = "nodebuffer";
  return {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    buffered: () => ws.bufferedAmount,
    onOpen: (cb) => ws.on("open", cb),
    onText: (cb) => ws.on("message", (d: RawData, isBinary: boolean) => (isBinary ? undefined : cb(d.toString()))),
    onBinary: (cb) => ws.on("message", (d: RawData, isBinary: boolean) => (isBinary ? cb(toUint8(d)) : undefined)),
    onClose: (cb) => ws.on("close", (code: number, reason: Buffer) => cb(code, reason.toString())),
    onError: (cb) => ws.on("error", cb),
  };
}
