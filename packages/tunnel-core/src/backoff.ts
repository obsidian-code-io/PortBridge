const BASE_MS = 500;
const MAX_MS = 15_000;

/** Exponential backoff with full jitter (attempt 0-based). */
export function backoffDelay(attempt: number): number {
  const ceil = Math.min(MAX_MS, BASE_MS * 2 ** Math.min(attempt, 20));
  return Math.floor(ceil / 2 + Math.random() * (ceil / 2));
}
