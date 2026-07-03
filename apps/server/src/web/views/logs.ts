import { html } from "hono/html";
import type { Html } from "./html.ts";
import { layout } from "./layout.ts";

export function logsPage(id: string, text: string, csrf: string): Html {
  const body = html`<section>
    <h2 class="mb-1 text-lg font-medium">Sidecar logs</h2>
    <p class="mb-3 font-mono text-xs text-slate-500">${id}</p>
    <pre class="overflow-x-auto rounded-md border border-slate-800 bg-slate-950 p-3 text-xs text-slate-200">${text === "" ? "(no output)" : text}</pre>
    <a href="/" class="mt-3 inline-block text-sm text-slate-400 hover:text-slate-200">← back</a>
  </section>`;
  return layout("Sidecar logs", body, csrf);
}
