/**
 * Access control model: roles scope who may forward which target (by port
 * AND/OR container), and per-user API keys bind a role to a credential. A
 * Principal is the resolved caller — the admin (unrestricted superuser) or a
 * keyed user carrying a role. Enforcement is a pure function of the principal
 * and the (container, port) it is trying to forward.
 */

export interface RoleScope {
  readonly allPorts: boolean; // true ⇒ any target port
  readonly ports: readonly number[]; // allowed target ports when !allPorts
  readonly allContainers: boolean; // true ⇒ any container
  readonly containers: readonly string[]; // allowed container names when !allContainers
}

export interface Role {
  readonly id: string;
  readonly name: string;
  readonly scope: RoleScope;
  readonly createdAt: number;
}

export interface ApiKeyRecord {
  readonly id: string;
  readonly label: string; // the party/user this key belongs to
  readonly roleId: string;
  readonly prefix: string; // non-secret display id, e.g. "pbk_1a2b3c4d"
  readonly createdAt: number;
  readonly revokedAt: number | null;
}

/** The admin-defined universe of scopable ports/containers, set at onboarding. */
export interface AccessConfig {
  readonly enabled: boolean;
  readonly ports: readonly number[];
  readonly containers: readonly string[];
}

export const ACCESS_DEFAULTS: AccessConfig = { enabled: false, ports: [], containers: [] };

export type Principal =
  | { readonly kind: "admin" }
  | { readonly kind: "user"; readonly keyId: string; readonly label: string; readonly role: Role };

export const ADMIN_PRINCIPAL: Principal = { kind: "admin" };

/** True if `principal` may open a forward to `container` on `port`. */
export function forwardAllowed(principal: Principal, container: string, port: number): boolean {
  if (principal.kind === "admin") return true;
  const s = principal.role.scope;
  const portOk = s.allPorts || s.ports.includes(port);
  const containerOk = s.allContainers || s.containers.includes(container);
  return portOk && containerOk;
}

/** A short human explanation for a denied forward (for API/UI error copy). */
export function denyReason(principal: Principal, container: string, port: number): string {
  if (principal.kind === "admin") return "";
  const s = principal.role.scope;
  if (!s.allPorts && !s.ports.includes(port)) return `Role "${principal.role.name}" may not forward port ${port}.`;
  if (!s.allContainers && !s.containers.includes(container)) {
    return `Role "${principal.role.name}" may not forward container "${container}".`;
  }
  return "";
}
