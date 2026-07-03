/**
 * List + normalize containers for the "targets" view.
 *
 * Excludes PortBridge's own container (matched via HOSTNAME self-inspect) and
 * every managed sidecar (label portbridge.managed=true) — you never forward to
 * yourself or to another forward.
 */

import type Docker from "dockerode";
import type { ContainerInfo, ContainerInspectInfo } from "dockerode";

export interface NetworkInfo {
  readonly name: string;
  readonly ipAddress: string | undefined;
}

export interface PortInfo {
  readonly port: number;
  readonly protocol: "tcp";
  readonly published: boolean;
}

export interface Target {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly state: string;
  readonly networks: readonly NetworkInfo[];
  readonly ports: readonly PortInfo[];
}

const MANAGED_LABEL = "portbridge.managed";

function isManaged(summary: ContainerInfo): boolean {
  return summary.Labels[MANAGED_LABEL] === "true";
}

async function getSelfId(docker: Docker): Promise<string | undefined> {
  const hostname = process.env.HOSTNAME;
  if (hostname === undefined || hostname === "") return undefined;
  try {
    const info = await docker.getContainer(hostname).inspect();
    return info.Id;
  } catch {
    return undefined;
  }
}

function parsePortKey(key: string): { port: number; protocol: string } | undefined {
  const [portStr, protocol] = key.split("/");
  const port = Number.parseInt(portStr ?? "", 10);
  if (!Number.isInteger(port) || protocol === undefined) return undefined;
  return { port, protocol };
}

function normalizePorts(inspect: ContainerInspectInfo): PortInfo[] {
  const bound = inspect.NetworkSettings?.Ports ?? {};
  const keys = new Set<string>([
    ...Object.keys(inspect.Config?.ExposedPorts ?? {}),
    ...Object.keys(bound),
  ]);
  const result: PortInfo[] = [];
  for (const key of keys) {
    const parsed = parsePortKey(key);
    if (parsed === undefined || parsed.protocol !== "tcp") continue;
    const bindings = bound[key];
    result.push({
      port: parsed.port,
      protocol: "tcp",
      published: Array.isArray(bindings) && bindings.length > 0,
    });
  }
  return result.sort((a, b) => a.port - b.port);
}

function normalizeNetworks(inspect: ContainerInspectInfo): NetworkInfo[] {
  const networks = inspect.NetworkSettings?.Networks ?? {};
  return Object.entries(networks).map(([name, net]) => ({
    name,
    ipAddress: net?.IPAddress ? net.IPAddress : undefined,
  }));
}

function toTarget(inspect: ContainerInspectInfo): Target {
  return {
    id: inspect.Id.slice(0, 12),
    name: (inspect.Name ?? "").replace(/^\//, ""),
    image: inspect.Config?.Image ?? "<unknown>",
    state: inspect.State?.Status ?? "unknown",
    networks: normalizeNetworks(inspect),
    ports: normalizePorts(inspect),
  };
}

/**
 * The list of forwardable containers. Excludes self and managed sidecars.
 * (This is NOT the source of truth for active forwards — see forwards.ts.)
 */
export async function listTargets(docker: Docker): Promise<Target[]> {
  const [summaries, selfId] = await Promise.all([
    docker.listContainers({ all: true }),
    getSelfId(docker),
  ]);
  const candidates = summaries.filter(
    (s) => !isManaged(s) && s.Id !== selfId,
  );
  const inspected = await Promise.all(
    candidates.map((s) => docker.getContainer(s.Id).inspect()),
  );
  return inspected.map(toTarget).sort((a, b) => a.name.localeCompare(b.name));
}
