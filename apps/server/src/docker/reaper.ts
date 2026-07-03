/**
 * Expiry + reconciliation loop. Every 30s it lists managed sidecars (the label
 * source of truth), removes any whose expires.at has passed, and notices
 * sidecars that vanished out-of-band. It never throws out of the loop: every
 * per-forward failure is caught and logged so one bad forward can't stall it.
 */

import type Docker from "dockerode";
import type { Forward } from "./forward-types.ts";
import { deleteForward, listForwards } from "./forwards.ts";
import type { AuditWriter } from "../audit/types.ts";

const DEFAULT_INTERVAL_MS = 30_000;

export interface Reaper {
  stop(): void;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function reconcileMissing(
  previous: ReadonlySet<string>,
  current: ReadonlySet<string>,
  audit: AuditWriter,
): void {
  for (const id of previous) {
    if (!current.has(id)) {
      audit.write({ actor: "reaper", action: "reconciled_missing", forwardId: id });
    }
  }
}

async function expireOne(
  docker: Docker,
  forward: Forward,
  audit: AuditWriter,
  expired: Set<string>,
): Promise<void> {
  try {
    await deleteForward(docker, forward.id);
    audit.write({
      actor: "reaper",
      action: "forward_expired",
      forwardId: forward.id,
      targetName: forward.targetName,
      targetPort: String(forward.targetPort),
      hostPort: String(forward.hostPort),
    });
    expired.add(forward.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[reaper] failed to expire ${forward.id}: ${msg}`);
  }
}

async function expireDue(
  docker: Docker,
  forwards: readonly Forward[],
  now: number,
  audit: AuditWriter,
): Promise<Set<string>> {
  const expired = new Set<string>();
  for (const forward of forwards) {
    if (forward.expiresAt === "never" || forward.expiresAt >= now) continue;
    await expireOne(docker, forward, audit, expired);
  }
  return expired;
}

/** One reaper pass. Returns the id set to carry into the next tick. */
export async function runReaperOnce(
  docker: Docker,
  audit: AuditWriter,
  previous: ReadonlySet<string>,
): Promise<Set<string>> {
  const current = await listForwards(docker);
  const currentIds = new Set(current.map((f) => f.id));
  reconcileMissing(previous, currentIds, audit);
  const expired = await expireDue(docker, current, nowSeconds(), audit);
  for (const id of expired) currentIds.delete(id);
  return currentIds;
}

/** Start the 30s reaper. Returns a handle whose stop() clears the interval. */
export function startReaper(
  docker: Docker,
  audit: AuditWriter,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): Reaper {
  let previous = new Set<string>();
  const tick = async (): Promise<void> => {
    try {
      previous = await runReaperOnce(docker, audit, previous);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[reaper] tick failed: ${msg}`);
    }
  };
  const handle = setInterval(() => void tick(), intervalMs);
  void tick();
  return { stop: () => clearInterval(handle) };
}
