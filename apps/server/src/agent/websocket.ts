/**
 * The Bun websocket handler wired into the server's default export. It reuses
 * Hono's open/close/message dispatch and adds a `drain` hook — Hono's WSEvents
 * don't surface Bun's drain, which the byte pipe needs to relieve backpressure.
 */

import { websocket as honoWebsocket } from "hono/bun";
import { handleDrain } from "./pipe.ts";

type RawWs = Parameters<typeof honoWebsocket.open>[0];

export const agentWebsocket = {
  ...honoWebsocket,
  drain(ws: RawWs): void {
    handleDrain(ws);
  },
};
