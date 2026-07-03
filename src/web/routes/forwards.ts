import { Hono } from "hono";
import type { Context } from "hono";
import type Docker from "dockerode";
import type { Config } from "../../config.ts";
import type { AppEnv } from "../env.ts";
import type { CreateForwardInput } from "../../docker/forward-types.ts";
import { listTargets } from "../../docker/containers.ts";
import { createForward, deleteForward, extendForward, listForwards } from "../../docker/forwards.ts";
import { ForwardError } from "../../docker/forwards-errors.ts";
import {
  forwardError,
  forwardForm,
  forwardResultCard,
  managedForwardsTable,
} from "../views/forwards.ts";

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

async function handleCreate(docker: Docker, config: Config, c: Context) {
  const parsed = parseForwardInput(await c.req.parseBody());
  if (!parsed.ok) return c.html(forwardError(parsed.error), 400);
  try {
    const forward = await createForward(docker, config, parsed.input);
    c.header("HX-Trigger", "forwardsChanged");
    return c.html(forwardResultCard(forward, hostOf(c.req.header("host"))));
  } catch (err) {
    return c.html(forwardError(messageFor(err)), 400);
  }
}

export function forwardRoutes(docker: Docker, config: Config): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/forwards/panel", (c) => c.html(""));

  router.get("/forwards/new", async (c) => {
    const target = (await listTargets(docker)).find((t) => t.id === c.req.query("target"));
    if (target === undefined) return c.html(forwardError("Target no longer exists."), 404);
    return c.html(forwardForm(target));
  });

  router.get("/forwards/table", async (c) => {
    const forwards = await listForwards(docker);
    return c.html(managedForwardsTable(forwards, hostOf(c.req.header("host")), Math.floor(Date.now() / 1000)));
  });

  router.post("/forwards", (c) => handleCreate(docker, config, c));

  router.post("/forwards/:id/extend", async (c) => {
    const ttlRaw = asString((await c.req.parseBody())["ttl"]) ?? String(config.defaultTtlMinutes);
    const ttl = ttlRaw === "never" ? "never" : asInt(ttlRaw) ?? config.defaultTtlMinutes;
    try {
      const forward = await extendForward(docker, config, c.req.param("id"), ttl);
      c.header("HX-Trigger", "forwardsChanged");
      return c.html(forwardResultCard(forward, hostOf(c.req.header("host"))));
    } catch (err) {
      return c.html(forwardError(messageFor(err)), 400);
    }
  });

  router.post("/forwards/:id/delete", async (c) => {
    await deleteForward(docker, c.req.param("id"));
    c.header("HX-Trigger", "forwardsChanged");
    return c.html("");
  });

  return router;
}
