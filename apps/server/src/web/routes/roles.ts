/**
 * Roles & API-keys management API (admin only). This is the programmatic
 * surface for creating roles and issuing per-user keys, mounted under /api so
 * it authenticates by Bearer credential. Every route requires the admin
 * principal; a keyed user cannot mint roles or keys.
 */

import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.ts";
import { AccessStore, AccessError } from "../../access/store.ts";
import type { ApiKeyRecord, Role, RoleScope } from "../../access/types.ts";

const adminOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("principal").kind !== "admin") return c.json({ error: "forbidden" }, 403);
  return next();
};

function parseScope(b: Record<string, unknown>): RoleScope {
  const ports = Array.isArray(b["ports"]) ? b["ports"].map(Number).filter(Number.isInteger) : [];
  const containers = Array.isArray(b["containers"]) ? b["containers"].filter((x): x is string => typeof x === "string") : [];
  return { allPorts: b["allPorts"] === true, ports, allContainers: b["allContainers"] === true, containers };
}

function roleView(r: Role) {
  return { id: r.id, name: r.name, scope: r.scope, createdAt: r.createdAt };
}

function keyView(k: ApiKeyRecord) {
  return { id: k.id, label: k.label, roleId: k.roleId, prefix: k.prefix, createdAt: k.createdAt, revokedAt: k.revokedAt };
}

async function jsonBody(c: Parameters<MiddlewareHandler>[0]): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return typeof b === "object" && b !== null ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function rolesRoutes(access: AccessStore): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  router.use("/api/roles", adminOnly);
  router.use("/api/roles/*", adminOnly);
  router.use("/api/keys", adminOnly);
  router.use("/api/keys/*", adminOnly);
  router.use("/api/access-config", adminOnly);

  router.get("/api/roles", (c) => c.json(access.listRoles().map(roleView)));

  router.post("/api/roles", async (c) => {
    const b = await jsonBody(c);
    try {
      const role = access.createRole(String(b["name"] ?? ""), parseScope(b));
      return c.json(roleView(role), 201);
    } catch (err) {
      if (err instanceof AccessError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  router.delete("/api/roles/:id", (c) => {
    try {
      const ok = access.deleteRole(c.req.param("id"));
      return c.json({ deleted: ok }, ok ? 200 : 404);
    } catch (err) {
      if (err instanceof AccessError) return c.json({ error: err.message }, 409);
      throw err;
    }
  });

  router.get("/api/keys", (c) => c.json(access.listKeys().map(keyView)));

  router.post("/api/keys", async (c) => {
    const b = await jsonBody(c);
    try {
      const { record, plaintext } = access.createKey(String(b["label"] ?? ""), String(b["roleId"] ?? ""));
      // The plaintext key is returned exactly once — never retrievable again.
      return c.json({ ...keyView(record), key: plaintext }, 201);
    } catch (err) {
      if (err instanceof AccessError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  router.delete("/api/keys/:id", (c) => {
    const ok = access.revokeKey(c.req.param("id"));
    return c.json({ revoked: ok }, ok ? 200 : 404);
  });

  router.get("/api/access-config", (c) => c.json(access.getAccessConfig()));
  router.put("/api/access-config", async (c) => {
    const b = await jsonBody(c);
    const ports = Array.isArray(b["ports"]) ? b["ports"].map(Number).filter(Number.isInteger) : [];
    const containers = Array.isArray(b["containers"]) ? b["containers"].filter((x): x is string => typeof x === "string") : [];
    return c.json(access.setAccessConfig({ enabled: b["enabled"] === true, ports, containers }));
  });

  return router;
}
