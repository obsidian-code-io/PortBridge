/**
 * Bootstrap: parse+validate config (fail closed), construct the Docker client,
 * build the app, and start serving. The reaper starts after the first Docker
 * ping succeeds (and self-heals if Docker is down at boot).
 */

import { loadConfig, ConfigError, type Config } from "./config.ts";
import { getDocker } from "./docker/client.ts";
import { startReaper } from "./docker/reaper.ts";
import { consoleAuditWriter } from "./audit/types.ts";
import { createApp } from "./web/app.ts";

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
const audit = consoleAuditWriter;
const app = createApp(docker, config, audit);

async function startBackground(): Promise<void> {
  try {
    await docker.ping();
    console.info("[portbridge] docker reachable — starting reaper (30s)");
  } catch {
    console.warn("[portbridge] docker unreachable at boot — reaper will retry each tick");
  }
  startReaper(docker, audit);
}
void startBackground();

console.info(`[portbridge] listening on :${config.port}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
