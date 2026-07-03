/**
 * Append-only audit log. This file exposes ONLY write() and query(); there are
 * intentionally no update or delete paths — the audit trail is immutable.
 */

import type { Database, Statement } from "bun:sqlite";
import type { AuditEvent, AuditReader, AuditRow, AuditWriter } from "./types.ts";

const INSERT_SQL = `
INSERT INTO audit_log (id, at, actor, action, forward_id, target_name, target_port, host_port, ttl_minutes, detail)
VALUES ($id, $at, $actor, $action, $forward_id, $target_name, $target_port, $host_port, $ttl_minutes, $detail)
`;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export class SqliteAuditLog implements AuditWriter, AuditReader {
  private readonly insert: Statement;

  constructor(private readonly db: Database) {
    this.insert = db.query(INSERT_SQL);
  }

  write(event: AuditEvent): void {
    this.insert.run({
      $id: Bun.randomUUIDv7(),
      $at: nowSeconds(),
      $actor: event.actor,
      $action: event.action,
      $forward_id: event.forwardId ?? null,
      $target_name: event.targetName ?? null,
      $target_port: event.targetPort ?? null,
      $host_port: event.hostPort ?? null,
      $ttl_minutes: event.ttlMinutes ?? null,
      $detail: event.detail ?? null,
    });
  }

  query(action: string | undefined, limit: number): AuditRow[] {
    if (action !== undefined && action !== "") {
      return this.db
        .query("SELECT * FROM audit_log WHERE action = $action ORDER BY at DESC, id DESC LIMIT $limit")
        .all({ $action: action, $limit: limit }) as AuditRow[];
    }
    return this.db
      .query("SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT $limit")
      .all({ $limit: limit }) as AuditRow[];
  }
}
