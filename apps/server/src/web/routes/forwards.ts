import { Hono } from "hono";
import type { Context } from "hono";
import type Docker from "dockerode";
import type { Config } from "../../config.ts";
import type { AppEnv } from "../env.ts";
import type { AuditWriter } from "../../audit/types.ts";
import type { CreateForwardInput, Forward, ForwardRegistry } from "../../docker/forward-types.ts";
import { listTargets } from "../../docker/containers.ts";
import {
  createForward,
  deleteForward,
  extendForward,
  listForwards,
  tailForwardLogs,
} from "../../docker/forwards.ts";
import { ForwardError } from "../../docker/forwards-errors.ts";
import { forwardError, forwardForm, forwardResultCard, managedForwardsTable } from "../views/forwards.ts";
import { logsPage } from "../views/logs.ts";

const LOG_TAIL_LINES = 200;

type ParseResult =
  | { readonly ok: true; readonly input: CreateForwardInput }
  | { readonly ok: false; readonly error: string };

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asInt(value: unknown): number | undefined {
  const raw = asString(value);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) ? n : undefined;
}

function hostOf(host: string | undefined): string {
  return (host ?? "localhost").split(":")[0] ?? "localhost";
}

function parseForwardInput(body: Record<string, unknown>): ParseResult {
  const targetId = asString(body["targetId"]);
  const targetPort = asInt(body["targetPort"]);
  if (targetId === undefined || targetPort === undefined) {
    return { ok: false, error: "Target and target port are required." };
  }
  const ttlRaw = asString(body["ttl"]) ?? "never";
  const ttl = ttlRaw === "never" ? "never" : asInt(ttlRaw);
  if (ttl === undefined) return { ok: false, error: "Invalid TTL." };
  if (ttl === "never" && asString(body["confirmNever"]) !== "1") {
    return { ok: false, error: "Tick the confirm box to open a forward that never expires." };
  }
  return { ok: true, input: { targetId, targetPort, hostPort: asInt(body["hostPort"]), ttlMinutes: ttl } };
}

function messageFor(err: unknown): string {
  if (err instanceof ForwardError) return err.message;
  return "Failed to create forward — check the sidecar logs.";
}

function auditCreated(audit: AuditWriter, action: "forward_created" | "forward_extend", f: Forward): void {
  audit.write({
    actor: "admin",
    action,
    forwardId: f.id,
    targetName: f.targetName,
    targetPort: String(f.targetPort),
    hostPort: f.hostPort === null ? undefined : String(f.hostPort),
    ttlMinutes: f.expiresAt === "never" ? undefined : Math.round((f.expiresAt - f.createdAt) / 60),
    detail: f.expiresAt === "never" ? "never" : undefined,
  });
}

async function handleCreate(docker: Docker, config: Config, audit: AuditWriter, registry: ForwardRegistry, c: Context) {
  const parsed = parseForwardInput(await c.req.parseBody());
  if (!parsed.ok) return c.html(forwardError(parsed.error), 400);
  try {
    const forward = await createForward(docker, config, registry, parsed.input);
    auditCreated(audit, "forward_created", forward);
    c.header("HX-Trigger", "forwardsChanged");
    return c.html(forwardResultCard(forward, hostOf(c.req.header("host"))));
  } catch (err) {
    audit.write({ actor: "admin", action: "create_failed", detail: messageFor(err) });
    return c.html(forwardError(messageFor(err)), 400);
  }
}

async function handleExtend(
  docker: Docker,
  config: Config,
  audit: AuditWriter,
  registry: ForwardRegistry,
  c: Context,
  id: string,
) {
  const ttlRaw = asString((await c.req.parseBody())["ttl"]) ?? String(config.defaultTtlMinutes);
  const ttl = ttlRaw === "never" ? "never" : asInt(ttlRaw) ?? config.defaultTtlMinutes;
  try {
    const forward = await extendForward(docker, config, registry, id, ttl);
    auditCreated(audit, "forward_extend", forward);
    c.header("HX-Trigger", "forwardsChanged");
    return c.html(forwardResultCard(forward, hostOf(c.req.header("host"))));
  } catch (err) {
    return c.html(forwardError(messageFor(err)), 400);
  }
}

export function forwardRoutes(
  docker: Docker,
  config: Config,
  audit: AuditWriter,
  registry: ForwardRegistry,
): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/forwards/panel", (c) => c.html(""));

  router.get("/forwards/new", async (c) => {
    const target = (await listTargets(docker)).find((t) => t.id === c.req.query("target"));
    if (target === undefined) return c.html(forwardError("Target no longer exists."), 404);
    return c.html(forwardForm(target));
  });

  router.get("/forwards/table", async (c) => {
    const forwards = await listForwards(docker, registry);
    return c.html(managedForwardsTable(forwards, hostOf(c.req.header("host")), Math.floor(Date.now() / 1000)));
  });

  router.get("/forwards/:id/logs", async (c) => {
    const id = c.req.param("id");
    try {
      return c.html(logsPage(id, await tailForwardLogs(docker, id, LOG_TAIL_LINES), c.get("csrf")));
    } catch (err) {
      return c.html(logsPage(id, messageFor(err), c.get("csrf")), 404);
    }
  });

  router.post("/forwards", (c) => handleCreate(docker, config, audit, registry, c));
  router.post("/forwards/:id/extend", (c) => handleExtend(docker, config, audit, registry, c, c.req.param("id")));

  router.post("/forwards/:id/delete", async (c) => {
    const id = c.req.param("id");
    const isTunnel = registry.has(id);
    await deleteForward(docker, registry, id, "ui");
    audit.write(
      isTunnel
        ? { actor: "admin", action: "tunnel_revoked", forwardId: id, detail: "ui" }
        : { actor: "admin", action: "forward_deleted", forwardId: id },
    );
    c.header("HX-Trigger", "forwardsChanged");
    return c.html("");
  });

  return router;
}
