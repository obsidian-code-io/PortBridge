/**
 * Stream-token helpers. Uses Web Crypto (`crypto.getRandomValues`) and no
 * Node-only APIs, so the same code runs under Bun and Node.
 */

const DEFAULT_TOKEN_BYTES = 32;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Cryptographically random stream token (>= 32 bytes of entropy), base64url. */
export function generateStreamToken(byteLength: number = DEFAULT_TOKEN_BYTES): string {
  const bytes = new Uint8Array(Math.max(DEFAULT_TOKEN_BYTES, byteLength));
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Constant-time token comparison. Length mismatch returns false. */
export function equalsToken(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i += 1) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}
