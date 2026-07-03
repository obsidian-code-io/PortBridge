/**
 * PortBridge client. Owns one shared control connection and the set of active
 * tunnels, re-asserting them whenever the control connection comes back up.
 */

import type { ForwardView, TargetView } from "@obsidiancode/portbridge-protocol";
import { encodeHandshake } from "@obsidiancode/portbridge-protocol";
import type { Socket } from "node:net";
import { ControlConnection } from "./control-conn.ts";
import { ClientPipe } from "./pipe.ts";
import { connectWs } from "./ws.ts";
import { Tunnel, type OpenTunnelSpec } from "./tunnel.ts";

export interface ClientOptions {
  /** Base HTTP(S) URL of the PortBridge server (user-supplied). */
  readonly url: string;
  /** Admin token (from config). Never logged. */
  readonly token: string;
}

export interface PortBridgeClient {
  targets(): Promise<TargetView[]>;
  forwards(): Promise<ForwardView[]>;
  openTunnel(spec: OpenTunnelSpec): Promise<Tunnel>;
  close(): void;
}

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

class PortBridgeClientImpl implements PortBridgeClient {
  private readonly control: ControlConnection;
  private readonly tunnels = new Set<Tunnel>();

  constructor(private readonly opts: ClientOptions) {
    this.control = new ControlConnection(opts.url, opts.token);
    this.control.onUp(() => void this.reassert());
    this.control.onDown(() => this.tunnels.forEach((t) => t.deactivate()));
    this.control.onRevoked((forwardId, reason) => this.onRevoked(forwardId, reason));
  }

  targets(): Promise<TargetView[]> {
    return getJson<TargetView[]>(`${this.opts.url}/api/targets`, this.opts.token);
  }

  forwards(): Promise<ForwardView[]> {
    return getJson<ForwardView[]>(`${this.opts.url}/api/forwards`, this.opts.token);
  }

  async openTunnel(spec: OpenTunnelSpec): Promise<Tunnel> {
    await this.control.ensureConnected();
    const tunnel = new Tunnel(spec, this.control, (f, t, s) => this.openStream(f, t, s), (t) => this.tunnels.delete(t));
    this.tunnels.add(tunnel);
    await tunnel.activate();
    return tunnel;
  }

  private onRevoked(forwardId: string, reason: string): void {
    for (const tunnel of this.tunnels) {
      if (tunnel.forwardId === forwardId) tunnel.handleRevoked(reason);
    }
  }

  private async reassert(): Promise<void> {
    for (const tunnel of this.tunnels) {
      try {
        await tunnel.activate();
      } catch (err) {
        tunnel.emit("error", err);
      }
    }
  }

  private openStream(forwardId: string, streamToken: string, socket: Socket): void {
    // Buffer bytes the local app sends before the data WS is open, then replay
    // them through the pipe in order (Bun sockets don't retain early bytes).
    const early: Uint8Array[] = [];
    const collect = (chunk: Buffer): void => void early.push(new Uint8Array(chunk));
    socket.on("data", collect);
    const ws = connectWs(`${this.opts.url}/agent/stream`);
    ws.onOpen(() => {
      ws.send(encodeHandshake({ forwardId, streamToken }));
      socket.off("data", collect);
      new ClientPipe(ws, socket).prime(early);
    });
    ws.onError(() => socket.destroy());
  }

  close(): void {
    this.tunnels.forEach((t) => void t.close());
    this.control.close();
  }
}

export function createClient(opts: ClientOptions): PortBridgeClient {
  return new PortBridgeClientImpl(opts);
}
