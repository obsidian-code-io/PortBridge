import { html, raw } from "hono/html";
import type { Html } from "./html.ts";

// Tailwind + HTMX via CDN are fine for v1. Replace the Tailwind CDN with a
// built stylesheet before shipping to production (the CDN warns in console and
// ships the full JIT compiler to the browser).
const TAILWIND_CDN = "https://cdn.tailwindcss.com";
const HTMX_CDN = "https://unpkg.com/htmx.org@2.0.3";

function headerRight(csrf: string | undefined): Html {
  if (csrf === undefined) {
    return html`<span class="text-xs text-slate-500">self-hosted docker forwards</span>`;
  }
  return html`<div class="flex items-center gap-3">
    <a href="/audit" class="text-xs text-slate-400 hover:text-slate-200">audit</a>
    <button class="text-xs text-slate-400 hover:text-slate-200" hx-post="/logout">sign out</button>
  </div>`;
}

// When authenticated we attach the CSRF token to every HTMX request via
// hx-headers on <body>; swapped-in content inherits it up the DOM.
export function layout(title: string, body: Html, csrf?: string): Html {
  // csrf is a hex nonce (randomBytes.toString("hex")) — safe to inject raw.
  const hxHeaders = csrf === undefined ? "" : `hx-headers='{"X-CSRF-Token":"${csrf}"}'`;
  return html`<!doctype html>
<html lang="en" class="h-full">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · PortBridge</title>
    <script src="${TAILWIND_CDN}"></script>
    <script src="${HTMX_CDN}"></script>
  </head>
  <body class="h-full bg-slate-950 text-slate-100" ${raw(hxHeaders)}>
    <div class="mx-auto max-w-6xl px-4 py-6">
      <header class="mb-6 flex items-center justify-between border-b border-slate-800 pb-4">
        <h1 class="text-xl font-semibold tracking-tight">PortBridge</h1>
        ${headerRight(csrf)}
      </header>
      ${body}
    </div>
  </body>
</html>`;
}
