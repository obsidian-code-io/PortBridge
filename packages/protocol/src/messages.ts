/**
 * Wire message types shared by the PortBridge server and client. This is the
 * single source of truth for the control + data protocol; both sides import it.
 */

export type TtlMinutes = number | "never";

export type ForwardKind = "tcp" | "agent-tunnel";

// --- Control channel (GET /agent/control) ------------------------------------

/** C→S: request a tunnel. */
export interface OpenMessage {
  readonly type: "open";
  readonly reqId: string;
  readonly targetId: string;
  readonly targetPort: number;
  readonly ttlMinutes: TtlMinutes;
}

/** S→C: tunnel registered; streamToken authorizes its data WSs. */
export interface OpenedMessage {
  readonly type: "opened";
  readonly reqId: string;
  readonly forwardId: string;
  readonly streamToken: string;
}

/** S→C: open failed (unreachable / SSRF / max-forwards / bad target). */
export interface ErrorMessage {
  readonly type: "error";
  readonly reqId: string;
  readonly message: string;
}

/** C→S: client tears the tunnel down. */
export interface CloseMessage {
  readonly type: "close";
  readonly forwardId: string;
}

/** C→S: push out expiry. */
export interface ExtendMessage {
  readonly type: "extend";
  readonly forwardId: string;
  readonly ttlMinutes: TtlMinutes;
}

/** S→C: server killed it (TTL expiry or UI "kill"). */
export interface RevokedMessage {
  readonly type: "revoked";
  readonly forwardId: string;
  readonly reason: string;
}

export interface PingMessage {
  readonly type: "ping";
}

export interface PongMessage {
  readonly type: "pong";
}

export type ClientControlMessage =
  | OpenMessage
  | CloseMessage
  | ExtendMessage
  | PingMessage
  | PongMessage;

export type ServerControlMessage =
  | OpenedMessage
  | ErrorMessage
  | RevokedMessage
  | PingMessage
  | PongMessage;

export type ControlMessage = ClientControlMessage | ServerControlMessage;

// --- Data channel (GET /agent/stream) ----------------------------------------

/** First (JSON) frame on a data WS; binary frames follow. */
export interface StreamHandshake {
  readonly forwardId: string;
  readonly streamToken: string;
}

// --- Shared API DTOs (GET /api/targets, GET /api/forwards) --------------------

export interface TargetPortView {
  readonly port: number;
  readonly protocol: "tcp";
  readonly published: boolean;
}

export interface TargetView {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly state: string;
  readonly ports: readonly TargetPortView[];
}

/** JSON view of any forward. hostPort is null for agent-tunnels. */
export interface ForwardView {
  readonly id: string;
  readonly kind: ForwardKind;
  readonly targetName: string;
  readonly targetId: string;
  readonly targetPort: number;
  readonly hostPort: number | null;
  readonly network: string;
  readonly createdAt: number;
  readonly expiresAt: number | "never";
  readonly createdBy: string;
}
