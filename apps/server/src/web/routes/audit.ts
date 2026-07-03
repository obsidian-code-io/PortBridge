import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import type { AuditReader } from "../../audit/types.ts";
import { auditPage } from "../views/audit.ts";

const AUDIT_LIMIT = 500;

export function auditRoutes(reader: AuditReader): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/audit", (c) => {
    const action = c.req.query("action");
    const filter = action !== undefined && action !== "" ? action : undefined;
    return c.html(auditPage(reader.query(filter, AUDIT_LIMIT), filter, c.get("csrf")));
  });

  return router;
}
