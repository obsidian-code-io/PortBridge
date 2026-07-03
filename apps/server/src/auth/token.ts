import { secretEqual } from "./compare.ts";

/** Constant-time check of a submitted login token against the admin token. */
export function tokenMatches(provided: string, adminToken: string): boolean {
  if (provided === "") return false;
  return secretEqual(provided, adminToken);
}

/** Parse a `Bearer <token>` Authorization header; undefined if absent/malformed. */
export function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}
