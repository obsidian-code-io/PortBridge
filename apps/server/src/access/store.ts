/**
 * Access store — roles, per-user API keys, and the onboarding access config.
 * Shares the app's SQLite file. API keys are stored only as a SHA-256 hash; the
 * plaintext (`pbk_…`) is returned exactly once at creation and never persisted.
 */

import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  ACCESS_DEFAULTS,
  type AccessConfig,
  type ApiKeyRecord,
  type Role,
  type RoleScope,
} from "./types.ts";

const KEY_PREFIX = "pbk_";

export class AccessError extends Error {
  override readonly name = "AccessError";
}

function newId(): string {
  return Bun.randomUUIDv7();
}

function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function serializeScope(scope: RoleScope): string {
  return JSON.stringify(scope);
}

function parseScope(raw: string): RoleScope {
  const s = JSON.parse(raw) as Partial<RoleScope>;
  return {
    allPorts: s.allPorts === true,
    ports: Array.isArray(s.ports) ? s.ports.filter((p) => Number.isInteger(p)) : [],
    allContainers: s.allContainers === true,
    containers: Array.isArray(s.containers) ? s.containers.filter((c) => typeof c === "string") : [],
  };
}

interface RoleRow {
  id: string;
  name: string;
  scope: string;
  created_at: number;
}
interface KeyRow {
  id: string;
  label: string;
  role_id: string;
  prefix: string;
  created_at: number;
  revoked_at: number | null;
}

export class AccessStore {
  private readonly db: Database;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, "portbridge.db"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL, created_at INTEGER NOT NULL);",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, label TEXT NOT NULL, role_id TEXT NOT NULL, " +
        "key_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER);",
    );
    this.db.exec("CREATE TABLE IF NOT EXISTS access_config (id TEXT PRIMARY KEY, data TEXT NOT NULL);");
  }

  private now(): number {
    return Math.floor(Date.now() / 1000);
  }

  createRole(name: string, scope: RoleScope): Role {
    const trimmed = name.trim();
    if (trimmed === "") throw new AccessError("Role name is required.");
    const role: Role = { id: newId(), name: trimmed, scope, createdAt: this.now() };
    this.db
      .query("INSERT INTO roles (id, name, scope, created_at) VALUES ($id, $name, $scope, $at)")
      .run({ $id: role.id, $name: role.name, $scope: serializeScope(scope), $at: role.createdAt });
    return role;
  }

  private rowToRole(r: RoleRow): Role {
    return { id: r.id, name: r.name, scope: parseScope(r.scope), createdAt: r.created_at };
  }

  listRoles(): Role[] {
    const rows = this.db.query("SELECT * FROM roles ORDER BY created_at ASC").all() as RoleRow[];
    return rows.map((r) => this.rowToRole(r));
  }

  getRole(id: string): Role | undefined {
    const row = this.db.query("SELECT * FROM roles WHERE id = $id").get({ $id: id }) as RoleRow | null;
    return row === null ? undefined : this.rowToRole(row);
  }

  deleteRole(id: string): boolean {
    const inUse = this.db.query("SELECT 1 FROM api_keys WHERE role_id = $id AND revoked_at IS NULL").get({ $id: id });
    if (inUse !== null) throw new AccessError("Role is assigned to an active key; revoke those keys first.");
    return this.db.query("DELETE FROM roles WHERE id = $id").run({ $id: id }).changes > 0;
  }

  /** Create a key for a role. Returns the record and the one-time plaintext. */
  createKey(label: string, roleId: string): { record: ApiKeyRecord; plaintext: string } {
    const trimmed = label.trim();
    if (trimmed === "") throw new AccessError("Key label is required.");
    if (this.getRole(roleId) === undefined) throw new AccessError("Unknown role.");
    const plaintext = KEY_PREFIX + randomBytes(24).toString("hex");
    const record: ApiKeyRecord = {
      id: newId(),
      label: trimmed,
      roleId,
      prefix: plaintext.slice(0, KEY_PREFIX.length + 8),
      createdAt: this.now(),
      revokedAt: null,
    };
    this.db
      .query(
        "INSERT INTO api_keys (id, label, role_id, key_hash, prefix, created_at, revoked_at) " +
          "VALUES ($id, $label, $role, $hash, $prefix, $at, NULL)",
      )
      .run({ $id: record.id, $label: record.label, $role: roleId, $hash: hashKey(plaintext), $prefix: record.prefix, $at: record.createdAt });
    return { record, plaintext };
  }

  private rowToKey(r: KeyRow): ApiKeyRecord {
    return { id: r.id, label: r.label, roleId: r.role_id, prefix: r.prefix, createdAt: r.created_at, revokedAt: r.revoked_at };
  }

  listKeys(): ApiKeyRecord[] {
    const rows = this.db.query("SELECT * FROM api_keys ORDER BY created_at ASC").all() as KeyRow[];
    return rows.map((r) => this.rowToKey(r));
  }

  revokeKey(id: string): boolean {
    return this.db.query("UPDATE api_keys SET revoked_at = $at WHERE id = $id AND revoked_at IS NULL")
      .run({ $at: this.now(), $id: id }).changes > 0;
  }

  /** Look up a live key by its id (used to re-resolve a web session); undefined if revoked/missing. */
  getKeyById(id: string): ApiKeyRecord | undefined {
    const row = this.db
      .query("SELECT * FROM api_keys WHERE id = $id AND revoked_at IS NULL")
      .get({ $id: id }) as KeyRow | null;
    return row === null ? undefined : this.rowToKey(row);
  }

  /** Look up a live key by its plaintext; undefined if unknown or revoked. */
  resolveKey(plaintext: string): ApiKeyRecord | undefined {
    if (!plaintext.startsWith(KEY_PREFIX)) return undefined;
    const row = this.db
      .query("SELECT * FROM api_keys WHERE key_hash = $hash AND revoked_at IS NULL")
      .get({ $hash: hashKey(plaintext) }) as KeyRow | null;
    return row === null ? undefined : this.rowToKey(row);
  }

  getAccessConfig(): AccessConfig {
    const row = this.db.query("SELECT data FROM access_config WHERE id = 'singleton'").get() as { data: string } | null;
    if (row === null) return ACCESS_DEFAULTS;
    try {
      return { ...ACCESS_DEFAULTS, ...(JSON.parse(row.data) as Partial<AccessConfig>) };
    } catch {
      return ACCESS_DEFAULTS;
    }
  }

  setAccessConfig(config: AccessConfig): AccessConfig {
    this.db
      .query("INSERT INTO access_config (id, data) VALUES ('singleton', $data) ON CONFLICT(id) DO UPDATE SET data = $data")
      .run({ $data: JSON.stringify(config) });
    return config;
  }
}
