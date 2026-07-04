/**
 * Resolve a presented credential to a Principal, used at every auth point
 * (web login, /api/* bearer, agent control WS). The admin token maps to the
 * unrestricted admin; anything else is looked up as a live per-user API key.
 */

import type { Config } from "../config.ts";
import { tokenMatches } from "../auth/token.ts";
import { ADMIN_PRINCIPAL, type Principal } from "./types.ts";
import type { AccessStore } from "./store.ts";

export function resolvePrincipal(
  config: Config,
  access: AccessStore,
  credential: string | undefined,
): Principal | undefined {
  if (credential === undefined || credential === "") return undefined;
  if (tokenMatches(credential, config.adminToken)) return ADMIN_PRINCIPAL;
  const key = access.resolveKey(credential);
  if (key === undefined) return undefined;
  const role = access.getRole(key.roleId);
  if (role === undefined) return undefined;
  return { kind: "user", keyId: key.id, label: key.label, role };
}

/**
 * Resolve a web-session subject ("admin" or "u:<keyId>") to a Principal. A user
 * whose key was revoked or whose role vanished resolves to undefined, so the
 * session is treated as invalid on the next request (revocation takes effect).
 */
export function principalFromSub(access: AccessStore, sub: string): Principal | undefined {
  if (sub === "admin") return ADMIN_PRINCIPAL;
  if (!sub.startsWith("u:")) return undefined;
  const key = access.getKeyById(sub.slice(2));
  if (key === undefined) return undefined;
  const role = access.getRole(key.roleId);
  if (role === undefined) return undefined;
  return { kind: "user", keyId: key.id, label: key.label, role };
}
