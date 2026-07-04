/**
 * Roles & Access admin UI routes (session + HTMX). Admin only. Mutations emit
 * `access-rolesChanged` / `access-keysChanged` so the tables reload, and the
 * modal shows the newly-issued key's plaintext exactly once.
 */

import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { html } from "hono/html";
import type { AppEnv } from "../env.ts";
import { AccessStore, AccessError } from "../../access/store.ts";
import type { RoleScope } from "../../access/types.ts";
import { S_DANGER } from "../views/styles.ts";
import {
  accessPage, keyCreatedCard, keyForm, keysTable, roleForm, rolesTable,
} from "../views/access.ts";

const adminOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("principal").kind !== "admin") return c.text("forbidden", 403);
  return next();
};

function csv(v: unknown): string[] {
  return typeof v === "string" ? v.split(",").map((s) => s.trim()).filter((s) => s !== "") : [];
}

function parseRole(b: Record<string, unknown>): { name: string; scope: RoleScope } {
  const ports = csv(b["ports"]).map(Number).filter(Number.isInteger);
  return {
    name: String(b["name"] ?? ""),
    scope: { allPorts: b["allPorts"] !== undefined, ports, allContainers: b["allContainers"] !== undefined, containers: csv(b["containers"]) },
  };
}

function note(text: string) {
  return html`<div class="rounded-md border px-3 py-2 text-sm" style="${S_DANGER}">${text}</div>`;
}

export function accessRoutes(access: AccessStore): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  router.use("/access", adminOnly);
  router.use("/access/*", adminOnly);

  router.get("/access", (c) => c.html(accessPage(c.get("brand"), c.get("csrf"))));
  router.get("/access/roles/table", (c) => c.html(rolesTable(access.listRoles())));
  router.get("/access/keys/table", (c) => c.html(keysTable(access.listKeys(), access.listRoles())));
  router.get("/access/roles/new", (c) => c.html(roleForm()));
  router.get("/access/keys/new", (c) => c.html(keyForm(access.listRoles())));

  router.post("/access/roles", async (c) => {
    const { name, scope } = parseRole(await c.req.parseBody());
    try {
      const role = access.createRole(name, scope);
      c.header("HX-Trigger", "access-rolesChanged");
      return c.html(html`<div class="space-y-3 p-5 text-sm"><h3 class="text-base font-semibold" style="color:var(--brand-ok)">✓ Role "${role.name}" created</h3>
        <button type="button" onclick="pbCloseModal()" class="rounded-md px-3 py-2 text-sm font-medium hover:opacity-90"
          style="background:var(--brand-primary);color:var(--brand-primary-fg);min-height:44px">Done</button></div>`);
    } catch (err) {
      if (err instanceof AccessError) return c.html(roleForm(err.message), 400);
      throw err;
    }
  });

  router.post("/access/keys", async (c) => {
    const b = await c.req.parseBody();
    try {
      const { plaintext } = access.createKey(String(b["label"] ?? ""), String(b["roleId"] ?? ""));
      c.header("HX-Trigger", "access-keysChanged");
      return c.html(keyCreatedCard(plaintext));
    } catch (err) {
      if (err instanceof AccessError) return c.html(keyForm(access.listRoles(), err.message), 400);
      throw err;
    }
  });

  router.post("/access/roles/:id/delete", (c) => {
    try {
      access.deleteRole(c.req.param("id"));
      c.header("HX-Trigger", "access-rolesChanged");
      return c.body("");
    } catch (err) {
      if (err instanceof AccessError) return c.html(note(err.message), 409);
      throw err;
    }
  });

  router.post("/access/keys/:id/revoke", (c) => {
    access.revokeKey(c.req.param("id"));
    c.header("HX-Trigger", "access-keysChanged");
    return c.body("");
  });

  return router;
}
