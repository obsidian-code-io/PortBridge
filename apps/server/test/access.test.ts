import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccessStore, AccessError } from "../src/access/store.ts";
import { resolvePrincipal } from "../src/access/resolver.ts";
import { forwardAllowed, type Principal, type RoleScope } from "../src/access/types.ts";
import type { Config } from "../src/config.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function store(): AccessStore {
  const d = mkdtempSync(join(tmpdir(), "pb-access-"));
  dirs.push(d);
  return new AccessStore(d);
}
const scope = (s: Partial<RoleScope>): RoleScope => ({
  allPorts: false, ports: [], allContainers: false, containers: [], ...s,
});

describe("policy (port AND container)", () => {
  const role = { id: "r", name: "db", createdAt: 0, scope: scope({ ports: [5432], containers: ["postgres"] }) };
  const user: Principal = { kind: "user", keyId: "k", label: "alice", role };
  test("admin is unrestricted", () => {
    expect(forwardAllowed({ kind: "admin" }, "anything", 9999)).toBe(true);
  });
  test("both dimensions must match", () => {
    expect(forwardAllowed(user, "postgres", 5432)).toBe(true);
    expect(forwardAllowed(user, "postgres", 6379)).toBe(false); // wrong port
    expect(forwardAllowed(user, "redis", 5432)).toBe(false); // wrong container
  });
  test("wildcards open a dimension", () => {
    const wideUser: Principal = { kind: "user", keyId: "k", label: "a", role: { ...role, scope: scope({ allPorts: true, containers: ["postgres"] }) } };
    expect(forwardAllowed(wideUser, "postgres", 12345)).toBe(true);
    expect(forwardAllowed(wideUser, "redis", 12345)).toBe(false);
  });
});

describe("AccessStore", () => {
  test("roles + keys: create, resolve once, revoke, delete guard", () => {
    const s = store();
    const role = s.createRole("db-only", scope({ ports: [5432], allContainers: true }));
    expect(s.listRoles().map((r) => r.name)).toEqual(["db-only"]);

    const { record, plaintext } = s.createKey("alice", role.id);
    expect(plaintext.startsWith("pbk_")).toBe(true);
    expect(record.prefix.length).toBe("pbk_".length + 8);

    // resolve the live key back to its record
    expect(s.resolveKey(plaintext)?.id).toBe(record.id);
    expect(s.resolveKey("pbk_wrong")).toBeUndefined();

    // deleting a role with an active key is refused
    expect(() => s.deleteRole(role.id)).toThrow(AccessError);

    // revoke → key no longer resolves, and the role can be deleted
    expect(s.revokeKey(record.id)).toBe(true);
    expect(s.resolveKey(plaintext)).toBeUndefined();
    expect(s.deleteRole(role.id)).toBe(true);
  });

  test("bad input is rejected", () => {
    const s = store();
    expect(() => s.createRole("  ", scope({ allPorts: true }))).toThrow(AccessError);
    expect(() => s.createKey("x", "no-such-role")).toThrow(AccessError);
  });

  test("access config persists", () => {
    const s = store();
    expect(s.getAccessConfig().enabled).toBe(false);
    s.setAccessConfig({ enabled: true, ports: [5432, 6379], containers: ["postgres"] });
    expect(s.getAccessConfig()).toEqual({ enabled: true, ports: [5432, 6379], containers: ["postgres"] });
  });
});

describe("resolvePrincipal", () => {
  const config = { adminToken: "0123456789abcdef0123" } as unknown as Config;
  test("admin token → admin; live key → user; junk → undefined", () => {
    const s = store();
    const role = s.createRole("r", scope({ allPorts: true, allContainers: true }));
    const { plaintext } = s.createKey("bob", role.id);

    expect(resolvePrincipal(config, s, "0123456789abcdef0123")?.kind).toBe("admin");
    const user = resolvePrincipal(config, s, plaintext);
    expect(user?.kind).toBe("user");
    expect(user?.kind === "user" && user.label).toBe("bob");
    expect(resolvePrincipal(config, s, "nope")).toBeUndefined();
    expect(resolvePrincipal(config, s, undefined)).toBeUndefined();
  });
});
