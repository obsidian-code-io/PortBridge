import { Hono } from "hono";
import type Docker from "dockerode";
import type { Config } from "../config.ts";
import type { AuditWriter } from "../audit/types.ts";
import type { AppEnv } from "./env.ts";
import type { AuditReader } from "../audit/types.ts";
import { authGuard } from "../auth/middleware.ts";
import { loginRoutes } from "./routes/login.ts";
import { dashboardRoutes } from "./routes/dashboard.ts";
import { forwardRoutes } from "./routes/forwards.ts";
import { auditRoutes } from "./routes/audit.ts";

/** Assemble the full HTTP app. /healthz + /login are public; the guard denies
 *  everything else without a valid session (or a Bearer admin token on /api/*). */
export function createApp(
  docker: Docker,
  config: Config,
  audit: AuditWriter,
  reader: AuditReader,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/healthz", async (c) => {
    try {
      await docker.ping();
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  app.route("/", loginRoutes(config, audit));
  app.use("*", authGuard(config));
  app.route("/", dashboardRoutes(docker));
  app.route("/", forwardRoutes(docker, config, audit));
  app.route("/", auditRoutes(reader));

  return app;
}
