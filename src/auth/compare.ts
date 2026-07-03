import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time compare of two equal-length secrets. Length mismatch = false. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Constant-time compare that also hides length differences by comparing SHA-256
 * digests (always 32 bytes). Use for the admin token, whose length is secret.
 */
export function secretEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}
