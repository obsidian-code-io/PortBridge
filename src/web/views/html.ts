import type { HtmlEscapedString } from "hono/utils/html";

/** Result of hono's `html` tagged template — sync or async. */
export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;
