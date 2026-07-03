import { Hono } from "hono";
import type Docker from "dockerode";
import type { Config } from "../config.ts";
import type { AuditWriter } from "../audit/types.ts";
import type { AppEnv } from "./env.ts";
import type { AuditReader } from "../audit/types.ts";
import { authGuard } from "../auth/middleware.ts";
import { BrandStore } from "../brand/store.ts";
import { TunnelRegistry } from "../agent/registry.ts";
import { agentRoutes } from "../agent/routes.ts";
import { loginRoutes } from "./routes/login.ts";
import { dashboardRoutes } from "./routes/dashboard.ts";
import { forwardRoutes } from "./routes/forwards.ts";
import { auditRoutes } from "./routes/audit.ts";
import { apiRoutes } from "./routes/api.ts";

/**
 * Assemble the full HTTP app. Mount order matters:
 *  - /healthz + /login are public;
 *  - /agent/* mount BEFORE the session guard (they auth by Bearer header /
 *    token handshake, not the browser cookie);
 *  - everything else needs a valid session, and /api/* accepts a Bearer token.
 * Returns the shared TunnelRegistry so the caller can wire the reaper to it.
 */
export function createApp(
  docker: Docker,
  config: Config,
  audit: AuditWriter,
  reader: AuditReader,
): { app: Hono<AppEnv>; registry: TunnelRegistry } {
  const app = new Hono<AppEnv>();
  const registry = new TunnelRegistry(config.defaultTtlMinutes);
  const brand = new BrandStore(config.dataDir);

  // Make the brand config available to every rendered page (before first paint).
  app.use("*", async (c, next) => {
    c.set("brand", brand.get());
    return next();
  });

  app.get("/healthz", async (c) => {
    try {
      await docker.ping();
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  app.route("/", loginRoutes(config, audit));
  app.route("/", agentRoutes(docker, config, audit, registry));

  app.use("*", authGuard(config));
  app.route("/", dashboardRoutes(docker));
  app.route("/", forwardRoutes(docker, config, audit, registry));
  app.route("/", auditRoutes(reader));
  app.route("/", apiRoutes(docker, registry));

  return { app, registry };
}
