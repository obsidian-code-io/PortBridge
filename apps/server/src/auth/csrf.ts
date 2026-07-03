import type { Session } from "./session.ts";
import { constantTimeEqual } from "./compare.ts";

export const CSRF_HEADER = "x-csrf-token";

/** True when the submitted CSRF token matches the session's nonce. */
export function csrfValid(session: Session, provided: string | undefined): boolean {
  if (provided === undefined || provided === "") return false;
  return constantTimeEqual(provided, session.csrf);
}
