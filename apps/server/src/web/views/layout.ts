import { html, raw } from "hono/html";
import type { Html } from "./html.ts";
import type { BrandConfig } from "../../brand/types.ts";
import { brandStyleCss } from "../../brand/tokens.ts";
import {
  brandMark,
  CHROME_CSS,
  CHROME_JS,
  faviconTag,
  modalHost,
  themeToggle,
  THEME_INIT_JS,
  webfontLinks,
} from "./chrome.ts";

// Tailwind + HTMX via CDN are fine for v1. Replace the Tailwind CDN with a
// built stylesheet before shipping to production.
const TAILWIND_CDN = "https://cdn.tailwindcss.com";
const HTMX_CDN = "https://unpkg.com/htmx.org@2.0.3";

// Base a11y: always-visible keyboard focus (WCAG 2.4.7), reduced-motion respect,
// and bidi isolation so LTR technical content (commands, host:port, ids) keeps
// its character order and doesn't reorder inside an RTL layout.
const BASE_CSS =
  "*:focus-visible{outline:2px solid var(--brand-accent);outline-offset:2px;border-radius:3px}" +
  "@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}" +
  "code,pre{direction:ltr;unicode-bidi:isolate}.font-mono{unicode-bidi:isolate}" +
  ".pb-row:hover{background:var(--brand-elevated)}";

export interface LayoutOpts {
  readonly brand: BrandConfig;
  readonly csrf?: string; // present ⇒ authenticated (hx-headers + app nav)
  readonly bare?: boolean; // login / onboarding: no app nav
}

function nav(opts: LayoutOpts): Html {
  if (opts.bare === true || opts.csrf === undefined) {
    return html`<div class="flex items-center gap-2">
      <span class="text-xs" style="color:var(--brand-muted)">${opts.brand.tagline}</span>
      ${themeToggle()}
    </div>`;
  }
  // inline-flex + py padding keeps each hit target ≥24px tall (WCAG 2.5.8 AA).
  const link = "inline-flex items-center px-1.5 py-2 text-xs hover:opacity-80";
  return html`<div class="flex items-center gap-2" style="color:var(--brand-muted)">
    <a href="/" class="${link}">dashboard</a>
    <a href="/audit" class="${link}">audit</a>
    <a href="/settings" class="${link}">settings</a>
    <button class="${link}" hx-post="/logout" style="color:var(--brand-muted)">sign out</button>
    ${themeToggle()}
  </div>`;
}

function head(title: string, brand: BrandConfig): Html {
  return html`<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · ${brand.productName}</title>
    <script>${raw(THEME_INIT_JS)}</script>
    <style>${raw(brandStyleCss(brand))}</style>
    <style>${raw(BASE_CSS)}</style>
    <style>${raw(CHROME_CSS)}</style>
    ${raw(faviconTag(brand))}
    ${raw(webfontLinks(brand.fontFamily))}
    <script src="${TAILWIND_CDN}"></script>
    <script src="${HTMX_CDN}"></script>
  </head>`;
}

export function layout(title: string, body: Html, opts: LayoutOpts): Html {
  const { brand, csrf, bare } = opts;
  // csrf is a hex nonce — safe to inject raw.
  const hxHeaders = csrf === undefined ? "" : `hx-headers='{"X-CSRF-Token":"${csrf}"}'`;
  const app = bare !== true && csrf !== undefined;
  return html`<!doctype html>
<html lang="${brand.locale}" dir="${brand.dir}" class="h-full">
  ${head(title, brand)}
  <body class="h-full" style="background:var(--brand-bg);color:var(--brand-fg);font-family:var(--brand-font)" ${raw(hxHeaders)}>
    <div class="mx-auto max-w-6xl px-4 py-6">
      <header class="mb-6 flex items-center justify-between border-b pb-4" style="border-color:var(--brand-border)">
        <a href="/" class="flex items-center gap-2">${brandMark(brand)}</a>
        ${nav(opts)}
      </header>
      ${body}
    </div>
    ${app ? modalHost() : ""}
    <script>${raw(CHROME_JS)}</script>
  </body>
</html>`;
}
