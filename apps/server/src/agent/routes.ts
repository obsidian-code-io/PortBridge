/**
 * Agent WS endpoints. Mounted BEFORE the session guard (they authenticate by
 * Bearer header / token handshake, not the browser session cookie).
 */

import { Hono } from "hono";
import type Docker from "dockerode";
import { upgradeWebSocket } from "hono/bun";
import type { Config } from "../config.ts";
import type { AuditWriter } from "../audit/types.ts";
import type { AppEnv } from "../web/env.ts";
import { listTcpForwards } from "../docker/forwards.ts";
import { makeDialResolver } from "./reachability.ts";
import { TunnelRegistry } from "./registry.ts";
import { makeControlEvents } from "./control.ts";
import { makeStreamEvents } from "./stream.ts";
import { agentControlGuard, agentStreamGuard } from "./guards.ts";

export function agentRoutes(
  docker: Docker,
  config: Config,
  audit: AuditWriter,
  registry: TunnelRegistry,
): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const dial = makeDialResolver(docker);
  const count = async (): Promise<number> => (await listTcpForwards(docker)).length + registry.size();

  router.get(
    "/agent/control",
    agentControlGuard(config, audit),
    upgradeWebSocket(makeControlEvents({ registry, config, audit, dial, count })),
  );

  router.get(
    "/agent/stream",
    agentStreamGuard(),
    upgradeWebSocket(makeStreamEvents(registry, dial)),
  );

  return router;
}
