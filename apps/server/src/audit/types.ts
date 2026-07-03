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

/** A persisted audit row (snake_case mirrors the SQLite columns). */
export interface AuditRow {
  readonly id: string;
  readonly at: number;
  readonly actor: string;
  readonly action: string;
  readonly forward_id: string | null;
  readonly target_name: string | null;
  readonly target_port: string | null;
  readonly host_port: string | null;
  readonly ttl_minutes: number | null;
  readonly detail: string | null;
}

export interface AuditReader {
  query(action: string | undefined, limit: number): AuditRow[];
}

/** Placeholder writer used until the SQLite writer is wired in (Phase 5). */
export const consoleAuditWriter: AuditWriter = {
  write(event: AuditEvent): void {
    console.info(`[audit] ${event.action} ${event.forwardId ?? ""}`.trimEnd());
  },
};
