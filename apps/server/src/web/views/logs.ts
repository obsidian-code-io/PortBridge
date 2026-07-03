import { html } from "hono/html";
import type { Html } from "./html.ts";
import type { BrandConfig } from "../../brand/types.ts";
import { layout } from "./layout.ts";

export function logsPage(id: string, text: string, brand: BrandConfig, csrf: string): Html {
  const body = html`<section>
    <h2 class="mb-1 text-lg font-medium">Sidecar logs</h2>
    <p class="mb-3 font-mono text-xs" style="color:var(--brand-muted)">${id}</p>
    <pre class="overflow-x-auto rounded-md border p-3 text-xs" style="border-color:var(--brand-border);background:var(--brand-surface)">${text === "" ? "(no output)" : text}</pre>
    <a href="/" class="mt-3 inline-block text-sm hover:opacity-80" style="color:var(--brand-accent)">← back</a>
  </section>`;
  return layout("Sidecar logs", body, { brand, csrf });
}
