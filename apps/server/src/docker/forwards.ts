/**
 * Forward engine: allocate host ports, spawn/list/delete `alpine/socat`
 * sidecars. listForwards() is the ONLY source of truth for active forwards.
 */

import type Docker from "dockerode";
import type { ContainerCreateOptions, ContainerInspectInfo } from "dockerode";
import type { Config, PortRange } from "../config.ts";
import type { CreateForwardInput, Forward } from "./forward-types.ts";
import { getSelfId } from "./containers.ts";
import { buildLabels, forwardFromLabels, LABEL, MANAGED_FILTER } from "./labels.ts";
import { resolveNetwork, type ResolvedNetwork } from "./forwards-network.ts";
import {
  ForwardNotFoundError,
  HostPortUnavailableError,
  InvalidTargetError,
  MaxForwardsReachedError,
  NoFreePortError,
  TargetNotFoundError,
} from "./forwards-errors.ts";

const SIDECAR_MEMORY = 32 * 1024 * 1024;
const SIDECAR_NANOCPUS = 1e8;
const MAX_PORT_TRIES = 10;

/** Lowest free port in `range` not present in `used`. */
export function allocateHostPort(range: PortRange, used: ReadonlySet<number>): number {
  for (let port = range.start; port <= range.end; port += 1) {
    if (!used.has(port)) return port;
  }
  throw new NoFreePortError(`no free host port in ${range.start}-${range.end}`);
}

/** THE source of truth: reconstruct active forwards from sidecar labels. */
export async function listForwards(docker: Docker): Promise<Forward[]> {
  const summaries = await docker.listContainers({
    all: true,
    filters: { label: [MANAGED_FILTER] },
  });
  return summaries
    .map((s) => forwardFromLabels(s.Labels))
    .filter((f): f is Forward => f !== undefined)
    .sort((a, b) => a.hostPort - b.hostPort);
}

/** Force-remove the sidecar(s) for a forward id. Idempotent (missing = ok). */
export async function deleteForward(docker: Docker, id: string): Promise<void> {
  const summaries = await docker.listContainers({
    all: true,
    filters: { label: [`${LABEL.id}=${id}`] },
  });
  for (const s of summaries) {
    await removeIgnoringMissing(docker, s.Id);
  }
}

async function removeIgnoringMissing(docker: Docker, containerId: string): Promise<void> {
  try {
    await docker.getContainer(containerId).remove({ force: true });
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

async function inspectTarget(docker: Docker, id: string): Promise<ContainerInspectInfo> {
  let inspect: ContainerInspectInfo;
  try {
    inspect = await docker.getContainer(id).inspect();
  } catch {
    throw new TargetNotFoundError(`target container not found: ${id}`);
  }
  if (inspect.Config?.Labels?.[LABEL.managed] === "true") {
    throw new InvalidTargetError("cannot forward to a managed sidecar");
  }
  if (inspect.Id === (await getSelfId(docker))) {
    throw new InvalidTargetError("cannot forward to PortBridge itself");
  }
  return inspect;
}

function usedHostPorts(forwards: readonly Forward[]): Set<number> {
  return new Set(forwards.map((f) => f.hostPort));
}

async function ensureImage(docker: Docker, image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch {
    /* not present locally — pull below */
  }
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
      if (err !== null || stream === undefined) return reject(err ?? new Error("no pull stream"));
      docker.modem.followProgress(stream, (e: Error | null) => (e ? reject(e) : resolve()));
    });
  });
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function buildForward(
  input: CreateForwardInput,
  target: ContainerInspectInfo,
  hostPort: number,
  network: string,
): Forward {
  const createdAt = nowSeconds();
  return {
    id: Bun.randomUUIDv7(),
    kind: "tcp",
    targetName: (target.Name ?? "").replace(/^\//, ""),
    targetId: target.Id.slice(0, 12),
    targetPort: input.targetPort,
    hostPort,
    network,
    createdAt,
    expiresAt: input.ttlMinutes === "never" ? "never" : createdAt + input.ttlMinutes * 60,
    createdBy: "admin",
  };
}

function buildCreateOptions(
  config: Config,
  forward: Forward,
  connectRef: string,
): ContainerCreateOptions {
  const portKey = `${forward.hostPort}/tcp`;
  return {
    name: `portbridge-${forward.id}`,
    Image: config.socatImage,
    Cmd: [
      `TCP-LISTEN:${forward.hostPort},fork,reuseaddr`,
      `TCP-CONNECT:${connectRef}:${forward.targetPort}`,
    ],
    Labels: buildLabels(forward),
    ExposedPorts: { [portKey]: {} },
    HostConfig: {
      NetworkMode: forward.network,
      PortBindings: { [portKey]: [{ HostPort: String(forward.hostPort) }] },
      Memory: SIDECAR_MEMORY,
      NanoCpus: SIDECAR_NANOCPUS,
      RestartPolicy: { Name: "unless-stopped" },
      CapDrop: ["ALL"],
    },
  };
}

async function spawnSidecar(
  docker: Docker,
  config: Config,
  forward: Forward,
  connectRef: string,
): Promise<void> {
  const container = await docker.createContainer(buildCreateOptions(config, forward, connectRef));
  await container.start();
}

function validateManualPort(port: number, range: PortRange, used: ReadonlySet<number>): void {
  if (port < range.start || port > range.end) {
    throw new HostPortUnavailableError(`host port ${port} outside ${range.start}-${range.end}`);
  }
  if (used.has(port)) {
    throw new HostPortUnavailableError(`host port ${port} already in use by a forward`);
  }
}

async function attemptCreate(
  docker: Docker,
  config: Config,
  input: CreateForwardInput,
  target: ContainerInspectInfo,
  resolved: ResolvedNetwork,
  used: Set<number>,
): Promise<Forward> {
  const manual = input.hostPort;
  if (manual !== undefined) validateManualPort(manual, config.portRange, used);
  for (let attempt = 0; attempt < MAX_PORT_TRIES; attempt += 1) {
    const hostPort = manual ?? allocateHostPort(config.portRange, used);
    const forward = buildForward(input, target, hostPort, resolved.network);
    try {
      await spawnSidecar(docker, config, forward, resolved.connectRef);
      return forward;
    } catch (err) {
      if (manual !== undefined || !isPortTaken(err)) throw err;
      used.add(hostPort);
    }
  }
  throw new NoFreePortError("exhausted host-port allocation retries");
}

/** Create a forward, failing closed on limits, bad targets, or no network. */
export async function createForward(
  docker: Docker,
  config: Config,
  input: CreateForwardInput,
): Promise<Forward> {
  const existing = await listForwards(docker);
  if (existing.length >= config.maxForwards) {
    throw new MaxForwardsReachedError(`MAX_FORWARDS (${config.maxForwards}) reached`);
  }
  const target = await inspectTarget(docker, input.targetId);
  const resolved = await resolveNetwork(docker, target);
  await ensureImage(docker, config.socatImage);
  return attemptCreate(docker, config, input, target, resolved, usedHostPorts(existing));
}

/**
 * Extend a forward's TTL. Labels are immutable on a running container, so this
 * force-removes the sidecar and recreates it with the same target/port/network
 * and a fresh expires.at — a brief connection blip. Returns the new forward.
 */
export async function extendForward(
  docker: Docker,
  config: Config,
  id: string,
  ttlMinutes: number | "never",
): Promise<Forward> {
  const current = (await listForwards(docker)).find((f) => f.id === id);
  if (current === undefined) throw new ForwardNotFoundError(`forward not found: ${id}`);
  await deleteForward(docker, id);
  return createForward(docker, config, {
    targetId: current.targetId,
    targetPort: current.targetPort,
    hostPort: current.hostPort,
    ttlMinutes,
  });
}

/** Docker non-TTY logs are frame-multiplexed: [type,0,0,0,len(4 BE)] + payload. */
function demuxDockerLogs(buf: Buffer): string {
  const parts: string[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i + 4);
    const end = i + 8 + len;
    if (end > buf.length) break;
    parts.push(buf.toString("utf8", i + 8, end));
    i = end;
  }
  return parts.length > 0 ? parts.join("") : buf.toString("utf8");
}

/** Tail the sidecar's logs — the debugging story for unreachable targets. */
export async function tailForwardLogs(docker: Docker, id: string, lines: number): Promise<string> {
  const summaries = await docker.listContainers({ all: true, filters: { label: [`${LABEL.id}=${id}`] } });
  const first = summaries[0];
  if (first === undefined) throw new ForwardNotFoundError(`forward not found: ${id}`);
  const out = await docker.getContainer(first.Id).logs({
    follow: false,
    stdout: true,
    stderr: true,
    tail: lines,
    timestamps: false,
  });
  return demuxDockerLogs(Buffer.isBuffer(out) ? out : Buffer.from(String(out)));
}

function statusCode(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "statusCode" in err) {
    const code = (err as { statusCode: unknown }).statusCode;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

function isNotFound(err: unknown): boolean {
  return statusCode(err) === 404;
}

function isPortTaken(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /already allocated|address already in use|port is already/i.test(message);
}
