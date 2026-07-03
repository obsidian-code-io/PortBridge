/**
 * Audit event contract. The SQLite-backed writer lands in Phase 5; the reaper
 * and routes depend only on this interface so they stay decoupled from storage.
 */

export type AuditAction =
  | "forward_created"
  | "forward_deleted"
  | "forward_expired"
  | "forward_extend"
  | "reconciled_missing"
  | "create_failed"
  | "login_ok"
  | "login_fail";

export interface AuditEvent {
  readonly actor: string;
  readonly action: AuditAction;
  readonly forwardId?: string;
  readonly targetName?: string;
  readonly targetPort?: string;
  readonly hostPort?: string;
  readonly ttlMinutes?: number;
  readonly detail?: string;
}

export interface AuditWriter {
  write(event: AuditEvent): void;
}

/** Placeholder writer used until the SQLite writer is wired in (Phase 5). */
export const consoleAuditWriter: AuditWriter = {
  write(event: AuditEvent): void {
    console.info(`[audit] ${event.action} ${event.forwardId ?? ""}`.trimEnd());
  },
};
