/**
 * Network resolution for a forward.
 *
 * Preference: the first *attachable* user-defined network on the target — the
 * sidecar joins it and reaches the target by container name via Docker DNS.
 * Fallback: the default `bridge`, where DNS does not resolve names, so we
 * connect by the target's bridge IP instead. If the target sits only on a
 * non-attachable overlay, there's nothing we can join → NonAttachableNetworkError.
 */

import type Docker from "dockerode";
import type { ContainerInspectInfo } from "dockerode";
import { NonAttachableNetworkError } from "./forwards-errors.ts";

export interface ResolvedNetwork {
  /** Network the sidecar attaches to. */
  readonly network: string;
  /** socat TCP-CONNECT reference: container name (DNS) or IP (bridge). */
  readonly connectRef: string;
}

const RESERVED = new Set(["host", "none"]);

function stripName(name: string | undefined): string {
  return (name ?? "").replace(/^\//, "");
}

async function isAttachable(docker: Docker, name: string): Promise<boolean> {
  try {
    const info = await docker.getNetwork(name).inspect();
    if (info.Driver === "bridge") return true;
    return info.Attachable === true;
  } catch {
    return false;
  }
}

async function firstAttachable(
  docker: Docker,
  names: readonly string[],
): Promise<string | undefined> {
  for (const name of names) {
    if (await isAttachable(docker, name)) return name;
  }
  return undefined;
}

export async function resolveNetwork(
  docker: Docker,
  target: ContainerInspectInfo,
): Promise<ResolvedNetwork> {
  const all = Object.keys(target.NetworkSettings?.Networks ?? {});
  const userDefined = all.filter((n) => n !== "bridge" && !RESERVED.has(n));
  const attachable = await firstAttachable(docker, userDefined);
  if (attachable !== undefined) {
    return { network: attachable, connectRef: stripName(target.Name) };
  }
  if (userDefined.length > 0) {
    throw new NonAttachableNetworkError(
      "target is only on non-attachable overlay network(s)",
    );
  }
  const bridgeIp = target.NetworkSettings?.Networks?.["bridge"]?.IPAddress;
  if (bridgeIp) return { network: "bridge", connectRef: bridgeIp };
  throw new NonAttachableNetworkError("no attachable network found for target");
}
