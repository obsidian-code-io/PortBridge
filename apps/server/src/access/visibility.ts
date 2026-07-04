/**
 * Visibility helpers: which targets/forwards a principal may see. Admin sees
 * everything; a keyed user sees only targets whose container is in scope and
 * that expose at least one in-scope port, and only forwards it could open.
 */

import type { Target } from "../docker/containers.ts";
import { forwardAllowed, type Principal } from "./types.ts";

export function targetVisible(principal: Principal, target: Target): boolean {
  if (principal.kind === "admin") return true;
  const s = principal.role.scope;
  const containerOk = s.allContainers || s.containers.includes(target.name);
  if (!containerOk) return false;
  if (s.allPorts) return true;
  return target.ports.some((p) => s.ports.includes(p.port));
}

export function forwardVisible(principal: Principal, targetName: string, targetPort: number): boolean {
  return forwardAllowed(principal, targetName, targetPort);
}
