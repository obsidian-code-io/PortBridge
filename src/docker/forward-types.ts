/** Shared forward domain types. `kind` is the v2 extension point (tcp only). */

export type ForwardKind = "tcp";

export interface Forward {
  readonly id: string;
  readonly kind: ForwardKind;
  readonly targetName: string;
  readonly targetId: string;
  readonly targetPort: number;
  readonly hostPort: number;
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
