/**
 * Server-side reachability. The PortBridge process can pipe bytes to a target
 * only when it shares a Docker network with it (direct dial). Cross-network
 * reach via a relay sidecar is out of scope for M2 — we throw a typed,
 * actionable TargetUnreachableError instead of silently mutating our own
 * network attachments.
 *
 * SSRF guard: the client sends a targetId (never a raw host:port). We resolve
 * it through the Docker socket; the dial host always comes from a
 * Docker-resolved container (name or bridge IP), so a client cannot pivot the
 * server into dialing arbitrary internal addresses.
 */

import type Docker from "dockerode";
import { resolveNetwork } from "../docker/forwards-network.ts";
import { inspectTarget } from "../docker/forwards.ts";

export class TargetUnreachableError extends Error {
  override readonly name = "TargetUnreachableError";
}

export interface DialTarget {
  readonly host: string;
  readonly port: number;
  readonly network: string;
  readonly targetName: string;
  readonly targetId: string;
}

/** The set of Docker networks the PortBridge container itself is attached to. */
export async function getSelfNetworks(docker: Docker): Promise<Set<string>> {
  const hostname = process.env.HOSTNAME;
  if (hostname === undefined || hostname === "") return new Set();
  try {
    const self = await docker.getContainer(hostname).inspect();
    return new Set(Object.keys(self.NetworkSettings?.Networks ?? {}));
  } catch {
    return new Set();
  }
}

/**
 * Resolve a client-supplied (targetId, targetPort) to a concrete dial address,
 * ONLY if the target's network is one the server shares. Rejects unknown
 * containers (SSRF), self/sidecars, and cross-network targets.
 */
export async function resolveDial(
  docker: Docker,
  selfNetworks: ReadonlySet<string>,
  targetId: string,
  targetPort: number,
): Promise<DialTarget> {
  const target = await inspectTarget(docker, targetId);
  const resolved = await resolveNetwork(docker, target);
  if (!selfNetworks.has(resolved.network)) {
    throw new TargetUnreachableError(
      `PortBridge is not on network ${resolved.network}; attach it ` +
        `(docker network connect ${resolved.network} portbridge) or use a TCP forward instead`,
    );
  }
  return {
    host: resolved.connectRef,
    port: targetPort,
    network: resolved.network,
    targetName: (target.Name ?? "").replace(/^\//, ""),
    targetId: target.Id.slice(0, 12),
  };
}

/** Dial resolver bound to a docker client, caching the server's own networks. */
export type DialResolver = (targetId: string, targetPort: number) => Promise<DialTarget>;

export function makeDialResolver(docker: Docker): DialResolver {
  let selfNetworks: Set<string> | undefined;
  return async (targetId, targetPort) => {
    if (selfNetworks === undefined) selfNetworks = await getSelfNetworks(docker);
    return resolveDial(docker, selfNetworks, targetId, targetPort);
  };
}
