/**
 * Data channel handler (GET /agent/stream). First message is the JSON
 * handshake { forwardId, streamToken }; the token is validated constant-time
 * against the registry. On success we dial the target and pipe raw bytes. Early
 * binary frames that race the async handshake are queued, then flushed in order.
 */

import { connect } from "node:net";
import type { WSContext } from "hono/ws";
import { decodeHandshake } from "@obsidiancode/portbridge-protocol";
import type { DialResolver } from "./reachability.ts";
import type { StreamSink, TunnelRegistry } from "./registry.ts";
import { registerDrain, StreamPipe, unregisterDrain, type WsSink } from "./pipe.ts";

const CLOSE_POLICY = 1008;
const CLOSE_ERROR = 1011;

interface RawBinaryWs {
  sendBinary(data: Uint8Array): number;
}

interface StreamState {
  readonly sink: WsSink & StreamSink;
  forwardId?: string;
  pipe?: StreamPipe;
  pending?: Uint8Array[];
}

const states = new WeakMap<object, StreamState>();

function rawOf(ws: WSContext): object {
  return ws.raw as object;
}

function sinkFor(ws: WSContext): WsSink & StreamSink {
  return {
    sendBinary: (data) => (ws.raw as RawBinaryWs | undefined)?.sendBinary(data) ?? -1,
    close: (code, reason) => ws.close(code, reason),
  };
}

async function startPipe(
  registry: TunnelRegistry,
  dial: DialResolver,
  state: StreamState,
  ws: WSContext,
  raw: string,
): Promise<void> {
  if (state.forwardId !== undefined) return ws.close(CLOSE_POLICY, "already handshaked");
  let forwardId: string;
  let token: string;
  try {
    ({ forwardId, streamToken: token } = decodeHandshake(raw));
  } catch {
    return ws.close(CLOSE_POLICY, "bad handshake");
  }
  const forward = registry.attachStream(forwardId, token, state.sink);
  if (forward === undefined) return ws.close(CLOSE_POLICY, "invalid stream token");
  state.forwardId = forwardId;
  try {
    const dt = await dial(forward.targetId, forward.targetPort);
    state.pipe = new StreamPipe(state.sink, connect({ host: dt.host, port: dt.port }));
    registerDrain(rawOf(ws), () => state.pipe?.onDrain());
    flushPending(state);
  } catch {
    ws.close(CLOSE_ERROR, "target unreachable");
  }
}

function flushPending(state: StreamState): void {
  const queued = state.pending ?? [];
  state.pending = undefined;
  for (const chunk of queued) state.pipe?.onWsMessage(chunk);
}

async function onMessage(
  registry: TunnelRegistry,
  dial: DialResolver,
  evt: MessageEvent,
  ws: WSContext,
): Promise<void> {
  const state = states.get(rawOf(ws));
  if (state === undefined) return;
  if (typeof evt.data === "string") return startPipe(registry, dial, state, ws, evt.data);
  const bytes = new Uint8Array(evt.data as ArrayBuffer);
  if (state.pipe !== undefined) state.pipe.onWsMessage(bytes);
  else (state.pending ??= []).push(bytes);
}

function onClose(registry: TunnelRegistry, ws: WSContext): void {
  const state = states.get(rawOf(ws));
  if (state === undefined) return;
  state.pipe?.onWsClose();
  if (state.forwardId !== undefined) registry.detachStream(state.forwardId, state.sink);
  unregisterDrain(rawOf(ws));
  states.delete(rawOf(ws));
}

/** Build the WSEvents factory for the data channel. */
export function makeStreamEvents(registry: TunnelRegistry, dial: DialResolver) {
  return () => ({
    onOpen(_evt: Event, ws: WSContext): void {
      states.set(rawOf(ws), { sink: sinkFor(ws) });
    },
    onMessage(evt: MessageEvent, ws: WSContext): void {
      void onMessage(registry, dial, evt, ws);
    },
    onClose(_evt: CloseEvent, ws: WSContext): void {
      onClose(registry, ws);
    },
    onError(_evt: Event, ws: WSContext): void {
      ws.close(CLOSE_ERROR, "stream error");
    },
  });
}
