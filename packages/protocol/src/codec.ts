/**
 * JSON codec for control + handshake messages with strict validation.
 * Malformed input throws a typed ProtocolError; unknown `type` is rejected.
 */

import type { ControlMessage, StreamHandshake, TtlMinutes } from "./messages.ts";

export class ProtocolError extends Error {
  override readonly name = "ProtocolError";
}

/** Compile-time exhaustiveness guard for discriminated unions. */
export function assertNever(value: never): never {
  throw new ProtocolError(`unexpected variant: ${JSON.stringify(value)}`);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new ProtocolError(`expected string for "${field}"`);
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ProtocolError(`expected finite number for "${field}"`);
  }
  return value;
}

function asTtl(value: unknown): TtlMinutes {
  return value === "never" ? "never" : asNumber(value, "ttlMinutes");
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new ProtocolError("message must be an object");
  return value as Record<string, unknown>;
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new ProtocolError(`invalid ${label} JSON`);
  }
}

function validateControl(rec: Record<string, unknown>): ControlMessage {
  switch (rec["type"]) {
    case "open":
      return { type: "open", reqId: asString(rec["reqId"], "reqId"), targetId: asString(rec["targetId"], "targetId"), targetPort: asNumber(rec["targetPort"], "targetPort"), ttlMinutes: asTtl(rec["ttlMinutes"]) };
    case "opened":
      return { type: "opened", reqId: asString(rec["reqId"], "reqId"), forwardId: asString(rec["forwardId"], "forwardId"), streamToken: asString(rec["streamToken"], "streamToken") };
    case "error":
      return { type: "error", reqId: asString(rec["reqId"], "reqId"), message: asString(rec["message"], "message") };
    case "close":
      return { type: "close", forwardId: asString(rec["forwardId"], "forwardId") };
    case "extend":
      return { type: "extend", forwardId: asString(rec["forwardId"], "forwardId"), ttlMinutes: asTtl(rec["ttlMinutes"]) };
    case "revoked":
      return { type: "revoked", forwardId: asString(rec["forwardId"], "forwardId"), reason: asString(rec["reason"], "reason") };
    case "ping":
      return { type: "ping" };
    case "pong":
      return { type: "pong" };
    default:
      throw new ProtocolError(`unknown message type: ${String(rec["type"])}`);
  }
}

export function encodeControl(message: ControlMessage): string {
  return JSON.stringify(message);
}

export function decodeControl(raw: string): ControlMessage {
  return validateControl(toRecord(parseJson(raw, "control")));
}

export function encodeHandshake(handshake: StreamHandshake): string {
  return JSON.stringify(handshake);
}

export function decodeHandshake(raw: string): StreamHandshake {
  const rec = toRecord(parseJson(raw, "handshake"));
  return {
    forwardId: asString(rec["forwardId"], "forwardId"),
    streamToken: asString(rec["streamToken"], "streamToken"),
  };
}
