/**
 * A tunnel handle. Binds 127.0.0.1:<localPort> and, per inbound socket, opens a
 * data WS via the injected openStream seam. On control loss the listener is
 * torn down (stop accepting into a dead tunnel) and rebuilt on reconnect with a
 * fresh forwardId/streamToken. State is surfaced via events; nothing throws out
 * to crash the host process.
 */

import { EventEmitter } from "node:events";
import { type AddressInfo, createServer, type Server, type Socket } from "node:net";
import type { ControlConnection } from "./control-conn.ts";

export interface OpenTunnelSpec {
  readonly targetId: string;
  readonly targetPort: number;
  readonly localPort?: number;
  readonly ttlMinutes?: number | "never";
}

/** Opens a data WS for one local connection and pipes bytes. */
export type OpenStreamFn = (forwardId: string, streamToken: string, socket: Socket) => void;

const DEFAULT_TTL = 60;

export class Tunnel extends EventEmitter {
  forwardId?: string;
  streamToken?: string;
  localPort?: number;
  private server?: Server;
  private closed = false;

  constructor(
    readonly spec: OpenTunnelSpec,
    private readonly conn: ControlConnection,
    private readonly openStream: OpenStreamFn,
    private readonly onClosed: (t: Tunnel) => void,
  ) {
    super();
  }

  /** (Re)establish the tunnel: request a fresh forward, then (re)bind the listener. */
  async activate(): Promise<void> {
    if (this.closed) return;
    const opened = await this.conn.open({
      targetId: this.spec.targetId,
      targetPort: this.spec.targetPort,
      ttlMinutes: this.spec.ttlMinutes ?? DEFAULT_TTL,
    });
    this.forwardId = opened.forwardId;
    this.streamToken = opened.streamToken;
    await this.relisten();
    this.emit("ready", { localPort: this.localPort, forwardId: this.forwardId });
  }

  private relisten(): Promise<void> {
    this.stopListener();
    const server = createServer((socket) => this.onConnection(socket));
    this.server = server;
    // Reuse the previously-bound port across reconnects so the address the user
    // connects to stays stable; fall back to the spec, then an auto-picked port.
    const port = this.localPort ?? this.spec.localPort ?? 0;
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        this.localPort = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  private onConnection(socket: Socket): void {
    if (this.forwardId === undefined || this.streamToken === undefined) {
      socket.destroy();
      return;
    }
    this.emit("connection", { remotePort: socket.remotePort });
    this.openStream(this.forwardId, this.streamToken, socket);
  }

  /** Control lost — stop accepting; the client rebuilds us on reconnect. */
  deactivate(): void {
    this.stopListener();
  }

  handleRevoked(reason: string): void {
    this.emit("revoked", { reason });
    this.stopListener();
  }

  private stopListener(): void {
    this.server?.close();
    this.server = undefined;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopListener();
    if (this.forwardId !== undefined) this.conn.send({ type: "close", forwardId: this.forwardId });
    this.onClosed(this);
    this.emit("closed", {});
  }
}
