import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type Docker from "dockerode";
import { openAuditDb } from "../src/audit/db.ts";
import { SqliteAuditLog } from "../src/audit/log.ts";
import { tailForwardLogs } from "../src/docker/forwards.ts";
import { ForwardNotFoundError } from "../src/docker/forwards-errors.ts";

const DIR = `/tmp/portbridge-audit-test-${process.pid}`;
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

function freshLog(): SqliteAuditLog {
  rmSync(DIR, { recursive: true, force: true });
  return new SqliteAuditLog(openAuditDb(DIR));
}

describe("SqliteAuditLog", () => {
  test("write then query returns rows newest-first", () => {
    const log = freshLog();
    log.write({ actor: "admin", action: "forward_created", forwardId: "a", hostPort: "30000" });
    log.write({ actor: "admin", action: "forward_deleted", forwardId: "a" });
    const rows = log.query(undefined, 500);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.action).toBe("forward_deleted"); // most recent first
    expect(rows[1]?.host_port).toBe("30000");
  });

  test("filters by action", () => {
    const log = freshLog();
    log.write({ actor: "1.2.3.4", action: "login_fail" });
    log.write({ actor: "1.2.3.4", action: "login_ok" });
    log.write({ actor: "1.2.3.4", action: "login_fail" });
    expect(log.query("login_fail", 500)).toHaveLength(2);
    expect(log.query("login_ok", 500)).toHaveLength(1);
  });

  test("respects the limit", () => {
    const log = freshLog();
    for (let i = 0; i < 10; i += 1) log.write({ actor: "admin", action: "forward_expired", forwardId: String(i) });
    expect(log.query(undefined, 3)).toHaveLength(3);
  });

  test("is append-only: exposes no mutation methods", () => {
    const log = freshLog() as unknown as Record<string, unknown>;
    expect(typeof log["update"]).toBe("undefined");
    expect(typeof log["delete"]).toBe("undefined");
    expect(typeof log["remove"]).toBe("undefined");
  });
});

function framed(payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  const header = Buffer.alloc(8);
  header[0] = 1;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

describe("tailForwardLogs", () => {
  test("de-multiplexes docker log frames", async () => {
    const fake = {
      listContainers: async () => [{ Id: "cid", Labels: {} }],
      getContainer: () => ({ logs: async () => framed("socat listening on 30000\n") }),
    } as unknown as Docker;
    expect(await tailForwardLogs(fake, "fid", 200)).toBe("socat listening on 30000\n");
  });

  test("throws when the sidecar is gone", async () => {
    const fake = { listContainers: async () => [] } as unknown as Docker;
    await expect(tailForwardLogs(fake, "missing", 200)).rejects.toBeInstanceOf(ForwardNotFoundError);
  });
});
