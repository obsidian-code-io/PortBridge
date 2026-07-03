/**
 * The label schema stamped on every sidecar. These labels are the ONLY source
 * of truth for active forwards — reconstruct forwards by reading them back.
 */

import type { Forward } from "./forward-types.ts";

export const LABEL = {
  managed: "portbridge.managed",
  id: "portbridge.id",
  targetName: "portbridge.target.name",
  targetId: "portbridge.target.id",
  targetPort: "portbridge.target.port",
  hostPort: "portbridge.host.port",
  network: "portbridge.network",
  createdAt: "portbridge.created.at",
  expiresAt: "portbridge.expires.at",
  createdBy: "portbridge.created.by",
  kind: "portbridge.kind",
} as const;

export const MANAGED_FILTER = `${LABEL.managed}=true`;

export function buildLabels(forward: Forward): Record<string, string> {
  return {
    [LABEL.managed]: "true",
    [LABEL.id]: forward.id,
    [LABEL.targetName]: forward.targetName,
    [LABEL.targetId]: forward.targetId,
    [LABEL.targetPort]: String(forward.targetPort),
    [LABEL.hostPort]: String(forward.hostPort),
    [LABEL.network]: forward.network,
    [LABEL.createdAt]: String(forward.createdAt),
    [LABEL.expiresAt]: forward.expiresAt === "never" ? "never" : String(forward.expiresAt),
    [LABEL.createdBy]: forward.createdBy,
    [LABEL.kind]: forward.kind,
  };
}

function toInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) ? n : undefined;
}

/** Reconstruct a Forward from a sidecar's labels; undefined if malformed. */
export function forwardFromLabels(labels: Record<string, string>): Forward | undefined {
  const id = labels[LABEL.id];
  const targetPort = toInt(labels[LABEL.targetPort]);
  const hostPort = toInt(labels[LABEL.hostPort]);
  const createdAt = toInt(labels[LABEL.createdAt]);
  if (id === undefined || targetPort === undefined || hostPort === undefined) return undefined;
  if (createdAt === undefined) return undefined;
  const expiresRaw = labels[LABEL.expiresAt] ?? "never";
  return {
    id,
    kind: "tcp",
    targetName: labels[LABEL.targetName] ?? "",
    targetId: labels[LABEL.targetId] ?? "",
    targetPort,
    hostPort,
    network: labels[LABEL.network] ?? "",
    createdAt,
    expiresAt: expiresRaw === "never" ? "never" : toInt(expiresRaw) ?? "never",
    createdBy: labels[LABEL.createdBy] ?? "admin",
  };
}
