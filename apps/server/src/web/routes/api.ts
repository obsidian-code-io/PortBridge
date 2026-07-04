/**
 * JSON API for the CLI + programmatic callers. Authenticated by the /api/*
 * Bearer path (admin token or a per-user key). Listings are filtered to what
 * the caller's role may see, and POST /api/forwards enforces the role scope
 * before opening a tcp forward. Returns the protocol's shared DTOs.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type Docker from "dockerode";
import type { ForwardView, TargetView } from "@obsidiancode/portbridge-protocol";
import type { Config } from "../../config.ts";
import type { AuditWriter } from "../../audit/types.ts";
import type { AppEnv } from "../env.ts";
import type { Forward, ForwardRegistry } from "../../docker/forward-types.ts";
import { listTargets, type Target } from "../../docker/containers.ts";
import { createForward, listForwards } from "../../docker/forwards.ts";
import { ForwardError } from "../../docker/forwards-errors.ts";
import { denyReason, forwardAllowed } from "../../access/types.ts";
import { forwardVisible, targetVisible } from "../../access/visibility.ts";

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

function asInt(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? v : NaN;
  return Number.isInteger(n) ? n : undefined;
}

async function createViaApi(
  docker: Docker,
  config: Config,
  audit: AuditWriter,
  registry: ForwardRegistry,
  c: Context<AppEnv>,
) {
  const principal = c.get("principal");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const targetId = typeof body["targetId"] === "string" ? body["targetId"] : "";
  const targetPort = asInt(body["targetPort"]);
  if (targetId === "" || targetPort === undefined) return c.json({ error: "targetId and targetPort are required" }, 400);
  const target = (await listTargets(docker)).find((t) => t.id === targetId);
  if (target === undefined) return c.json({ error: "unknown target" }, 404);
  if (!forwardAllowed(principal, target.name, targetPort)) {
    return c.json({ error: denyReason(principal, target.name, targetPort) || "forbidden" }, 403);
  }
  try {
    const forward = await createForward(docker, config, registry, {
      targetId, targetPort, hostPort: asInt(body["hostPort"]), ttlMinutes: asInt(body["ttlMinutes"]) ?? config.defaultTtlMinutes,
    });
    const actor = principal.kind === "admin" ? "admin" : principal.label;
    audit.write({ actor, action: "forward_created", forwardId: forward.id, targetName: forward.targetName, targetPort: String(forward.targetPort) });
    return c.json(toForwardView(forward), 201);
  } catch (err) {
    if (err instanceof ForwardError) return c.json({ error: err.message }, 400);
    throw err;
  }
}

export function apiRoutes(docker: Docker, config: Config, audit: AuditWriter, registry: ForwardRegistry): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/api/targets", async (c) => {
    const principal = c.get("principal");
    const targets = (await listTargets(docker)).filter((t) => targetVisible(principal, t));
    return c.json(targets.map(toTargetView));
  });

  router.get("/api/forwards", async (c) => {
    const principal = c.get("principal");
    const forwards = (await listForwards(docker, registry)).filter((f) => forwardVisible(principal, f.targetName, f.targetPort));
    return c.json(forwards.map(toForwardView));
  });

  router.post("/api/forwards", (c) => createViaApi(docker, config, audit, registry, c));

  return router;
}
