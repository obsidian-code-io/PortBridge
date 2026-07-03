import { describe, expect, test } from "bun:test";
import type Docker from "dockerode";
import { runReaperOnce } from "../src/docker/reaper.ts";
import { buildLabels } from "../src/docker/labels.ts";
import type { Forward, ForwardRegistry } from "../src/docker/forward-types.ts";
import type { AuditEvent, AuditWriter } from "../src/audit/types.ts";

// The reaper tests exercise tcp expiry/reconciliation with an empty tunnel registry.
const registry: ForwardRegistry = {
  list: () => [],
  size: () => 0,
  has: () => false,
  close: () => undefined,
  extend: () => undefined,
  expireDue: () => [],
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function forward(id: string, expiresAt: number | "never"): Forward {
  return {
    id, kind: "tcp", targetName: "t", targetId: "tid", targetPort: 80,
    hostPort: 30000, network: "bridge", createdAt: 1, expiresAt, createdBy: "admin",
  };
}

interface Sidecar {
  Id: string;
  Labels: Record<string, string>;
}

function sidecarOf(f: Forward): Sidecar {
  return { Id: `portbridge-${f.id}`, Labels: buildLabels(f) };
}

function matches(labels: Record<string, string>, filters: string[]): boolean {
  return filters.every((f) => {
    const [k, v] = f.split("=");
    return k !== undefined && labels[k] === v;
  });
}

function makeFake(forwards: Forward[]) {
  const sidecars: Sidecar[] = forwards.map(sidecarOf);
  const removed: string[] = [];
  const docker = {
    listContainers: async (o: { filters?: { label?: string[] } }) =>
      sidecars.filter((s) => matches(s.Labels, o.filters?.label ?? [])),
    getContainer: (id: string) => ({
      remove: async () => {
        const i = sidecars.findIndex((s) => s.Id === id);
        if (i < 0) return;
        removed.push(sidecars[i]!.Labels["portbridge.id"]!);
        sidecars.splice(i, 1);
      },
    }),
  };
  return { docker: docker as unknown as Docker, sidecars, removed };
}

function capture(): { audit: AuditWriter; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return { audit: { write: (e) => events.push(e) }, events };
}

describe("runReaperOnce", () => {
  test("expires past-due forwards and audits forward_expired", async () => {
    const now = nowSeconds();
    const fake = makeFake([forward("expired", now - 100), forward("fresh", now + 1000)]);
    const { audit, events } = capture();

    const remaining = await runReaperOnce(fake.docker, registry, audit, new Set());

    expect(fake.removed).toEqual(["expired"]);
    expect(remaining.has("expired")).toBe(false);
    expect(remaining.has("fresh")).toBe(true);
    expect(events.map((e) => e.action)).toEqual(["forward_expired"]);
    expect(events[0]?.forwardId).toBe("expired");
  });

  test("never-expiry forwards are left alone", async () => {
    const fake = makeFake([forward("keep", "never")]);
    const { audit, events } = capture();
    const remaining = await runReaperOnce(fake.docker, registry, audit, new Set());
    expect(fake.removed).toEqual([]);
    expect(remaining.has("keep")).toBe(true);
    expect(events).toHaveLength(0);
  });

  test("audits reconciled_missing for sidecars that vanished out-of-band", async () => {
    const now = nowSeconds();
    const fake = makeFake([forward("still-here", now + 1000)]);
    const { audit, events } = capture();

    // 'gone' was present last tick but has been docker-rm'd externally.
    const remaining = await runReaperOnce(fake.docker, registry, audit, new Set(["still-here", "gone"]));

    expect(events.map((e) => e.action)).toEqual(["reconciled_missing"]);
    expect(events[0]?.forwardId).toBe("gone");
    expect(remaining.has("still-here")).toBe(true);
  });

  test("an expired forward is not re-reported as missing next tick", async () => {
    const now = nowSeconds();
    const fake = makeFake([forward("expired", now - 100)]);
    const { audit, events } = capture();

    const afterFirst = await runReaperOnce(fake.docker, registry, audit, new Set());
    // Second tick: sidecar already gone, previous = afterFirst (excludes it).
    const afterSecond = await runReaperOnce(fake.docker, registry, audit, afterFirst);

    expect(events.map((e) => e.action)).toEqual(["forward_expired"]);
    expect(afterSecond.size).toBe(0);
  });

  test("a single tick also expires agent-tunnels via the registry (audits tunnel_expired)", async () => {
    const fake = makeFake([]);
    const { audit, events } = capture();
    const expiredTunnel = { ...forward("tun1", 1), kind: "agent-tunnel" as const, hostPort: null };
    const tunnelRegistry: ForwardRegistry = {
      ...registry,
      expireDue: () => [expiredTunnel],
    };

    await runReaperOnce(fake.docker, tunnelRegistry, audit, new Set());

    expect(events.map((e) => e.action)).toEqual(["tunnel_expired"]);
    expect(events[0]?.forwardId).toBe("tun1");
  });
});
