import { html, raw } from "hono/html";
import type { Html } from "./html.ts";
import type { BrandConfig } from "../../brand/types.ts";
import { brandStyleCss } from "../../brand/tokens.ts";

// Tailwind + HTMX via CDN are fine for v1. Replace the Tailwind CDN with a
// built stylesheet before shipping to production.
const TAILWIND_CDN = "https://cdn.tailwindcss.com";
const HTMX_CDN = "https://unpkg.com/htmx.org@2.0.3";

export interface LayoutOpts {
  readonly brand: BrandConfig;
  readonly csrf?: string; // present ⇒ authenticated (hx-headers + app nav)
  readonly bare?: boolean; // login / onboarding: no app nav
}

function brandMark(brand: BrandConfig): Html {
  if (brand.logoDark !== "") {
    return html`<img src="${brand.logoDark}" alt="${brand.productName}" class="h-6 w-auto" />`;
  }
  return html`<span class="text-xl font-semibold tracking-tight" style="color:var(--brand-fg)">${brand.productName}</span>`;
}

function nav(opts: LayoutOpts): Html {
  if (opts.bare === true || opts.csrf === undefined) {
    return html`<span class="text-xs" style="color:var(--brand-muted)">${opts.brand.tagline}</span>`;
  }
  const link = "text-xs hover:opacity-80";
  return html`<div class="flex items-center gap-3" style="color:var(--brand-muted)">
    <a href="/" class="${link}">dashboard</a>
    <a href="/audit" class="${link}">audit</a>
    <a href="/settings" class="${link}">settings</a>
    <button class="${link}" hx-post="/logout" style="color:var(--brand-muted)">sign out</button>
  </div>`;
}

export function layout(title: string, body: Html, opts: LayoutOpts): Html {
  const { brand, csrf } = opts;
  // csrf is a hex nonce — safe to inject raw.
  const hxHeaders = csrf === undefined ? "" : `hx-headers='{"X-CSRF-Token":"${csrf}"}'`;
  const favicon = brand.icon === "" ? "" : `<link rel="icon" href="${brand.icon}" />`;
  return html`<!doctype html>
<html lang="${brand.locale}" dir="${brand.dir}" class="h-full">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · ${brand.productName}</title>
    <style>${raw(brandStyleCss(brand))}</style>
    ${raw(favicon)}
    <script src="${TAILWIND_CDN}"></script>
    <script src="${HTMX_CDN}"></script>
  </head>
  <body class="h-full" style="background:var(--brand-bg);color:var(--brand-fg);font-family:var(--brand-font)" ${raw(hxHeaders)}>
    <div class="mx-auto max-w-6xl px-4 py-6">
      <header class="mb-6 flex items-center justify-between border-b pb-4" style="border-color:var(--brand-border)">
        <a href="/" class="flex items-center gap-2">${brandMark(brand)}</a>
        ${nav(opts)}
      </header>
      ${body}
    </div>
  </body>
</html>`;
}
