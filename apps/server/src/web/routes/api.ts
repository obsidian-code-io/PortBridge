/**
 * JSON API for the CLI. Reuses the /api/* Bearer path already in the auth
 * middleware. Returns the protocol's shared DTOs so client and server agree.
 */

import { Hono } from "hono";
import type Docker from "dockerode";
import type { ForwardView, TargetView } from "@obsidiancode/portbridge-protocol";
import type { AppEnv } from "../env.ts";
import type { Forward, ForwardRegistry } from "../../docker/forward-types.ts";
import { listTargets, type Target } from "../../docker/containers.ts";
import { listForwards } from "../../docker/forwards.ts";

function toTargetView(target: Target): TargetView {
  return {
    id: target.id,
    name: target.name,
    image: target.image,
    state: target.state,
    ports: target.ports.map((p) => ({ port: p.port, protocol: "tcp", published: p.published })),
  };
}

function toForwardView(forward: Forward): ForwardView {
  return {
    id: forward.id,
    kind: forward.kind,
    targetName: forward.targetName,
    targetId: forward.targetId,
    targetPort: forward.targetPort,
    hostPort: forward.hostPort,
    network: forward.network,
    createdAt: forward.createdAt,
    expiresAt: forward.expiresAt,
    createdBy: forward.createdBy,
  };
}

export function apiRoutes(docker: Docker, registry: ForwardRegistry): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/api/targets", async (c) => {
    return c.json((await listTargets(docker)).map(toTargetView));
  });

  router.get("/api/forwards", async (c) => {
    return c.json((await listForwards(docker, registry)).map(toForwardView));
  });

  return router;
}
