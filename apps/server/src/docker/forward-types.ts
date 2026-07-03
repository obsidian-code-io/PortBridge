/**
 * Shared forward domain types.
 *
 * There are now two forward kinds:
 *  - "tcp"          — a socat sidecar; state lives in Docker labels (v1).
 *  - "agent-tunnel" — a live WebSocket to a laptop; state lives ONLY in the
 *                     in-memory TunnelRegistry and dies with the connection or
 *                     a server restart. It is deliberately NOT label-backed and
 *                     NOT reconstructable from Docker (see registry.ts).
 *
 * Consequently `hostPort` is `number | null`: agent-tunnels publish no host
 * port. Every consumer that assumes a host port must branch on `kind`.
 */

export type ForwardKind = "tcp" | "agent-tunnel";

export interface Forward {
  readonly id: string;
  readonly kind: ForwardKind;
  readonly targetName: string;
  readonly targetId: string;
  readonly targetPort: number;
  readonly hostPort: number | null;
  readonly network: string;
  readonly createdAt: number;
  readonly expiresAt: number | "never";
  readonly createdBy: string;
}

export interface CreateForwardInput {
  readonly targetId: string;
  readonly targetPort: number;
  /** Manual host port; omitted means auto-allocate the lowest free port. */
  readonly hostPort?: number;
  readonly ttlMinutes: number | "never";
}

/**
 * The subset of the TunnelRegistry that docker/forwards.ts depends on, kept as
 * an interface so the docker layer needn't import the agent module concretely
 * (the concrete TunnelRegistry lives in src/agent/registry.ts).
 */
export interface ForwardRegistry {
  list(): readonly Forward[];
  size(): number;
  has(id: string): boolean;
  close(id: string, reason?: string): Forward | undefined;
  extend(id: string, ttlMinutes: number | "never"): Forward | undefined;
  expireDue(now: number): Forward[];
}
