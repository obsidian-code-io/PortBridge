import { describe, expect, test } from "bun:test";
import {
  decodeControl,
  decodeHandshake,
  encodeControl,
  encodeHandshake,
  equalsToken,
  generateStreamToken,
  ProtocolError,
  type ControlMessage,
} from "../src/index.ts";

const MESSAGES: ControlMessage[] = [
  { type: "open", reqId: "r1", targetId: "c1", targetPort: 5432, ttlMinutes: 60 },
  { type: "open", reqId: "r2", targetId: "c2", targetPort: 80, ttlMinutes: "never" },
  { type: "opened", reqId: "r1", forwardId: "f1", streamToken: "tok" },
  { type: "error", reqId: "r1", message: "unreachable" },
  { type: "close", forwardId: "f1" },
  { type: "extend", forwardId: "f1", ttlMinutes: 15 },
  { type: "revoked", forwardId: "f1", reason: "ttl" },
  { type: "ping" },
  { type: "pong" },
];

describe("control codec", () => {
  test("round-trips every message type", () => {
    for (const message of MESSAGES) {
      expect(decodeControl(encodeControl(message))).toEqual(message);
    }
  });

  test("rejects unknown type", () => {
    expect(() => decodeControl(JSON.stringify({ type: "nope" }))).toThrow(ProtocolError);
  });

  test("rejects malformed JSON and non-objects", () => {
    expect(() => decodeControl("{not json")).toThrow(ProtocolError);
    expect(() => decodeControl("42")).toThrow(ProtocolError);
  });

  test("rejects a message with a wrong field type", () => {
    expect(() => decodeControl(JSON.stringify({ type: "open", reqId: 1, targetId: "c", targetPort: 80, ttlMinutes: 60 }))).toThrow(ProtocolError);
    expect(() => decodeControl(JSON.stringify({ type: "open", reqId: "r", targetId: "c", targetPort: "80", ttlMinutes: 60 }))).toThrow(ProtocolError);
  });
});

describe("handshake codec", () => {
  test("round-trips", () => {
    const h = { forwardId: "f1", streamToken: "tok123" };
    expect(decodeHandshake(encodeHandshake(h))).toEqual(h);
  });
  test("rejects missing token", () => {
    expect(() => decodeHandshake(JSON.stringify({ forwardId: "f1" }))).toThrow(ProtocolError);
  });
});

describe("stream tokens", () => {
  test("generates >= 32 bytes of entropy, url-safe", () => {
    const token = generateStreamToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes base64url ≈ 43 chars
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  test("generates distinct tokens", () => {
    expect(generateStreamToken()).not.toBe(generateStreamToken());
  });

  test("equalsToken: equal, near-miss, length-mismatch", () => {
    const a = generateStreamToken();
    expect(equalsToken(a, a)).toBe(true);
    expect(equalsToken(a, a.slice(0, -1) + (a.endsWith("A") ? "B" : "A"))).toBe(false); // same length, one char off
    expect(equalsToken(a, a + "x")).toBe(false); // length mismatch
    expect(equalsToken("", "")).toBe(true);
  });
});
