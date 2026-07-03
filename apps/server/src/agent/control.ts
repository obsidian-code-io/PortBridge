/**
 * Control channel handler (GET /agent/control). One long-lived WS per agent.
 * Server pings every 20s and drops an agent that misses 2 pongs (half-open /
 * laptop-sleep detection). Handles open/close/extend; open validates the target
 * (SSRF + reachability) and enforces the shared MAX_FORWARDS cap.
 */

import type { WSContext } from "hono/ws";
import {
  assertNever,
  decodeControl,
  encodeControl,
  type ControlMessage,
  type OpenMessage,
} from "@obsidiancode/portbridge-protocol";
import type { Config } from "../config.ts";
import type { AuditWriter } from "../audit/types.ts";
import type { ControlSink, TunnelRegistry } from "./registry.ts";
import type { DialResolver } from "./reachability.ts";

const HEARTBEAT_MS = 20_000;
const MAX_MISSED_PONGS = 2;

export interface ControlDeps {
  readonly registry: TunnelRegistry;
  readonly config: Config;
  readonly audit: AuditWriter;
  readonly dial: DialResolver;
  readonly count: () => Promise<number>;
}

interface RawTextWs {
  send(data: string): unknown;
}

interface ControlState {
  readonly sink: ControlSink;
  awaitingPong: number;
  interval?: ReturnType<typeof setInterval>;
}

const states = new WeakMap<object, ControlState>();

function rawOf(ws: WSContext): object {
  return ws.raw as object;
}

function controlSink(raw: RawTextWs): ControlSink {
  return {
    send(message) {
      try {
        raw.send(encodeControl(message));
      } catch {
        /* ws already closed */
      }
    },
  };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : "open failed";
}

async function handleOpen(deps: ControlDeps, state: ControlState, msg: OpenMessage): Promise<void> {
  try {
    if ((await deps.count()) >= deps.config.maxForwards) {
      state.sink.send({ type: "error", reqId: msg.reqId, message: "MAX_FORWARDS reached" });
      return;
    }
    const dt = await deps.dial(msg.targetId, msg.targetPort);
    const { forward, streamToken } = deps.registry.open({
      targetId: dt.targetId,
      targetName: dt.targetName,
      targetPort: msg.targetPort,
      network: dt.network,
      ttlMinutes: msg.ttlMinutes,
      control: state.sink,
    });
    deps.audit.write({
      actor: "agent",
      action: "tunnel_opened",
      forwardId: forward.id,
      targetName: forward.targetName,
      targetPort: String(forward.targetPort),
      ttlMinutes: typeof msg.ttlMinutes === "number" ? msg.ttlMinutes : undefined,
    });
    state.sink.send({ type: "opened", reqId: msg.reqId, forwardId: forward.id, streamToken });
  } catch (err) {
    state.sink.send({ type: "error", reqId: msg.reqId, message: errText(err) });
  }
}

async function dispatch(deps: ControlDeps, state: ControlState, msg: ControlMessage): Promise<void> {
  switch (msg.type) {
    case "ping":
      return state.sink.send({ type: "pong" });
    case "pong":
      state.awaitingPong = 0;
      return;
    case "open":
      return handleOpen(deps, state, msg);
    case "close": {
      if (deps.registry.close(msg.forwardId) !== undefined) {
        deps.audit.write({ actor: "agent", action: "tunnel_closed", forwardId: msg.forwardId });
      }
      return;
    }
    case "extend":
      deps.registry.extend(msg.forwardId, msg.ttlMinutes);
      return;
    case "opened":
    case "error":
    case "revoked":
      return; // server→client only; ignore if a client sends them
    default:
      return assertNever(msg);
  }
}

function startHeartbeat(state: ControlState, ws: WSContext): ReturnType<typeof setInterval> {
  return setInterval(() => {
    if (state.awaitingPong >= MAX_MISSED_PONGS) {
      ws.close(1001, "heartbeat timeout");
      return;
    }
    state.sink.send({ type: "ping" });
    state.awaitingPong += 1;
  }, HEARTBEAT_MS);
}

function teardown(deps: ControlDeps, state: ControlState): void {
  if (state.interval !== undefined) clearInterval(state.interval);
  for (const forward of deps.registry.closeByControl(state.sink)) {
    deps.audit.write({ actor: "agent", action: "tunnel_closed", forwardId: forward.id, detail: "control_lost" });
  }
}

/** Build the WSEvents factory for the control channel. */
export function makeControlEvents(deps: ControlDeps) {
  return () => ({
    onOpen(_evt: Event, ws: WSContext): void {
      const state: ControlState = { sink: controlSink(ws.raw as RawTextWs), awaitingPong: 0 };
      state.interval = startHeartbeat(state, ws);
      states.set(rawOf(ws), state);
    },
    onMessage(evt: MessageEvent, ws: WSContext): void {
      const state = states.get(rawOf(ws));
      if (state === undefined) return;
      let message: ControlMessage;
      try {
        message = decodeControl(String(evt.data));
      } catch {
        return;
      }
      void dispatch(deps, state, message);
    },
    onClose(_evt: CloseEvent, ws: WSContext): void {
      const state = states.get(rawOf(ws));
      if (state === undefined) return;
      teardown(deps, state);
      states.delete(rawOf(ws));
    },
    onError(_evt: Event, ws: WSContext): void {
      ws.close(1011, "control error");
    },
  });
}
