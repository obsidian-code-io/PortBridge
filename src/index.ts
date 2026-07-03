/**
 * Bootstrap: parse+validate config (fail closed), construct the Docker client,
 * mount routes, and start serving. The reaper (Phase 3) starts here after the
 * first successful Docker ping.
 */

import { Hono } from "hono";
import { loadConfig, ConfigError, type Config } from "./config.ts";
import { getDocker } from "./docker/client.ts";
import { startReaper } from "./docker/reaper.ts";
import { consoleAuditWriter } from "./audit/types.ts";
import { dashboardRoutes } from "./web/routes/dashboard.ts";
import { forwardRoutes } from "./web/routes/forwards.ts";

function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    const message = err instanceof ConfigError ? err.message : String(err);
    console.error(`[portbridge] FATAL: refusing to boot — ${message}`);
    process.exit(1);
  }
}

const config = loadConfigOrExit();
const docker = getDocker(config);
const app = new Hono();

// Health check — no auth. Confirms the Docker socket is reachable.
app.get("/healthz", async (c) => {
  try {
    await docker.ping();
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false }, 503);
  }
});

// Dashboard + HTMX target search. (Auth guard lands in Phase 4.)
app.route("/", dashboardRoutes(docker));
app.route("/", forwardRoutes(docker, config));

// Start the reaper once we've confirmed Docker is reachable. If the daemon is
// down at boot we still start it — each tick tolerates failure and self-heals.
async function startBackground(): Promise<void> {
  try {
    await docker.ping();
    console.info("[portbridge] docker reachable — starting reaper (30s)");
  } catch {
    console.warn("[portbridge] docker unreachable at boot — reaper will retry each tick");
  }
  startReaper(docker, consoleAuditWriter);
}
void startBackground();

console.info(`[portbridge] listening on :${config.port}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
