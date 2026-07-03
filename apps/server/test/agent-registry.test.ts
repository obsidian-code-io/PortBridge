import { describe, expect, test } from "bun:test";
import type { ServerControlMessage } from "@obsidiancode/portbridge-protocol";
import { TunnelRegistry, type ControlSink, type StreamSink } from "../src/agent/registry.ts";

function control(): { sink: ControlSink; sent: ServerControlMessage[] } {
  const sent: ServerControlMessage[] = [];
  return { sink: { send: (m) => sent.push(m) }, sent };
}

function stream(): { sink: StreamSink; closes: number } {
  const state = { closes: 0 };
  return { sink: { close: () => (state.closes += 1, undefined) }, get closes() { return state.closes; } };
}

function openOne(reg: TunnelRegistry, sink: ControlSink, ttl: number | "never" = 15) {
  const result = reg.open({ targetId: "t", targetName: "echo", targetPort: 5432, network: "bridge", ttlMinutes: ttl, control: sink }, 1000);
  if (result === undefined) throw new Error("open unexpectedly returned undefined");
  return result;
}

describe("TunnelRegistry", () => {
  test("open yields an agent-tunnel forward with null hostPort + a token", () => {
    const reg = new TunnelRegistry(60);
    const c = control();
    const { forward, streamToken } = openOne(reg, c.sink);
    expect(forward.kind).toBe("agent-tunnel");
    expect(forward.hostPort).toBeNull();
    expect(streamToken.length).toBeGreaterThanOrEqual(43);
    expect(reg.size()).toBe(1);
    expect(reg.has(forward.id)).toBe(true);
    expect(reg.list().map((f) => f.id)).toEqual([forward.id]);
  });

  test("attachStream validates the token constant-time", () => {
    const reg = new TunnelRegistry(60);
    const { forward, streamToken } = openOne(reg, control().sink);
    const s = stream();
    expect(reg.attachStream(forward.id, "wrong-token-xxxxxxxxxxxxxxxxxxxxxxxxxxx", s.sink)).toBeUndefined();
    expect(reg.attachStream("no-such-id", streamToken, s.sink)).toBeUndefined();
    expect(reg.attachStream(forward.id, streamToken, s.sink)?.id).toBe(forward.id);
  });

  test("close(reason) sends revoked and closes streams; close() is silent", () => {
    const reg = new TunnelRegistry(60);
    const c = control();
    const { forward, streamToken } = openOne(reg, c.sink);
    const s = stream();
    reg.attachStream(forward.id, streamToken, s.sink);

    reg.close(forward.id, "ttl");
    expect(c.sent.some((m) => m.type === "revoked" && m.reason === "ttl")).toBe(true);
    expect(s.closes).toBe(1);
    expect(reg.has(forward.id)).toBe(false);

    const c2 = control();
    const other = openOne(reg, c2.sink);
    reg.close(other.forward.id); // no reason → no revoked
    expect(c2.sent.length).toBe(0);
  });

  test("revoking a tunnel invalidates its streams (token no longer attaches)", () => {
    const reg = new TunnelRegistry(60);
    const { forward, streamToken } = openOne(reg, control().sink);
    reg.close(forward.id, "ui");
    expect(reg.attachStream(forward.id, streamToken, stream().sink)).toBeUndefined();
  });

  test("extend pushes out expiry", () => {
    const reg = new TunnelRegistry(60);
    const { forward } = openOne(reg, control().sink, 15);
    const extended = reg.extend(forward.id, 600);
    expect(extended?.expiresAt).not.toBe("never");
    expect(extended?.expiresAt as number).toBeGreaterThan(forward.expiresAt as number);
  });

  test("expireDue closes only past-due tunnels and returns them", () => {
    const reg = new TunnelRegistry(60);
    const c = control();
    const { forward } = openOne(reg, c.sink, 15);
    openOne(reg, control().sink, "never"); // never expires
    const due = reg.expireDue(forward.createdAt + 16 * 60);
    expect(due.map((f) => f.id)).toEqual([forward.id]);
    expect(reg.size()).toBe(1); // the "never" one remains
  });

  test("open enforces the cap synchronously (no TOCTOU)", () => {
    const reg = new TunnelRegistry(60);
    const c = control();
    const first = reg.open({ targetId: "t", targetName: "n", targetPort: 1, network: "bridge", ttlMinutes: 15, control: c.sink }, 1);
    expect(first).toBeDefined();
    const second = reg.open({ targetId: "t", targetName: "n", targetPort: 2, network: "bridge", ttlMinutes: 15, control: c.sink }, 1);
    expect(second).toBeUndefined(); // cap reached
    expect(reg.size()).toBe(1);
  });

  test("closeByControl closes every tunnel owned by a dropped control", () => {
    const reg = new TunnelRegistry(60);
    const c1 = control();
    const c2 = control();
    openOne(reg, c1.sink);
    openOne(reg, c2.sink);
    openOne(reg, c1.sink);
    const closed = reg.closeByControl(c1.sink);
    expect(closed.length).toBe(2);
    expect(reg.size()).toBe(1);
  });
});
