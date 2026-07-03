/**
 * In-memory agent-tunnel registry — the SECOND source of truth.
 *
 * Unlike tcp forwards (reconstructable from Docker labels), an agent-tunnel has
 * no sidecar: it IS a live control WebSocket plus its data streams. Its state
 * lives only here and dies with the connection or a server restart — at which
 * point the CLI reconnects and re-opens. This is correct, not a compromise.
 */

import type { ServerControlMessage } from "@obsidiancode/portbridge-protocol";
import { equalsToken, generateStreamToken } from "@obsidiancode/portbridge-protocol";
import type { Forward, ForwardRegistry } from "../docker/forward-types.ts";

/** Sink for pushing control messages back to one agent (its control WS). */
export interface ControlSink {
  send(message: ServerControlMessage): void;
}

/** Sink for a single data stream WS (closed on revoke/teardown). */
export interface StreamSink {
  close(code?: number, reason?: string): void;
}

export interface OpenTunnelInput {
  readonly targetId: string;
  readonly targetName: string;
  readonly targetPort: number;
  readonly network: string;
  readonly ttlMinutes: number | "never";
  readonly control: ControlSink;
}

interface Entry {
  forward: Forward;
  readonly streamToken: string;
  readonly control: ControlSink;
  readonly streams: Set<StreamSink>;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function expiryFrom(createdAt: number, ttlMinutes: number | "never"): number | "never" {
  return ttlMinutes === "never" ? "never" : createdAt + ttlMinutes * 60;
}

export class TunnelRegistry implements ForwardRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly defaultTtlMinutes: number) {}

  size(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  list(): Forward[] {
    return [...this.entries.values()].map((e) => e.forward);
  }

  /**
   * Register a tunnel; returns the forward + the token that authorizes its
   * streams, or undefined if the registry is already at `maxForwards`. The cap
   * is checked and the entry inserted synchronously (no await between), so
   * pipelined opens can't race past it.
   */
  open(input: OpenTunnelInput, maxForwards: number): { forward: Forward; streamToken: string } | undefined {
    if (this.entries.size >= maxForwards) return undefined;
    const createdAt = nowSeconds();
    const ttl = input.ttlMinutes === "never" ? "never" : input.ttlMinutes || this.defaultTtlMinutes;
    const forward: Forward = {
      id: Bun.randomUUIDv7(),
      kind: "agent-tunnel",
      targetName: input.targetName,
      targetId: input.targetId,
      targetPort: input.targetPort,
      hostPort: null,
      network: input.network,
      createdAt,
      expiresAt: expiryFrom(createdAt, ttl),
      createdBy: "admin",
    };
    const streamToken = generateStreamToken();
    this.entries.set(forward.id, { forward, streamToken, control: input.control, streams: new Set() });
    return { forward, streamToken };
  }

  /** Validate a data stream's token (constant-time) and register its sink. */
  attachStream(id: string, token: string, stream: StreamSink): Forward | undefined {
    const entry = this.entries.get(id);
    if (entry === undefined || !equalsToken(token, entry.streamToken)) return undefined;
    entry.streams.add(stream);
    return entry.forward;
  }

  detachStream(id: string, stream: StreamSink): void {
    this.entries.get(id)?.streams.delete(stream);
  }

  extend(id: string, ttlMinutes: number | "never"): Forward | undefined {
    const entry = this.entries.get(id);
    if (entry === undefined) return undefined;
    entry.forward = { ...entry.forward, expiresAt: expiryFrom(nowSeconds(), ttlMinutes) };
    return entry.forward;
  }

  /** Tear a tunnel down. A `reason` marks it server-initiated → sends `revoked`. */
  close(id: string, reason?: string): Forward | undefined {
    const entry = this.entries.get(id);
    if (entry === undefined) return undefined;
    this.entries.delete(id);
    if (reason !== undefined) entry.control.send({ type: "revoked", forwardId: id, reason });
    for (const stream of entry.streams) stream.close(1000, reason ?? "closed");
    return entry.forward;
  }

  /** Close every tunnel expired at `now`; returns the closed forwards (for audit). */
  expireDue(now: number): Forward[] {
    const due = this.list().filter((f) => f.expiresAt !== "never" && f.expiresAt < now);
    return due.map((f) => this.close(f.id, "ttl")).filter((f): f is Forward => f !== undefined);
  }

  /** Close every tunnel owned by a (now-dead) control connection. */
  closeByControl(control: ControlSink): Forward[] {
    const owned = [...this.entries.values()].filter((e) => e.control === control).map((e) => e.forward.id);
    return owned.map((id) => this.close(id)).filter((f): f is Forward => f !== undefined);
  }
}
