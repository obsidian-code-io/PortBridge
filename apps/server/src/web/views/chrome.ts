/**
 * App chrome that isn't page content: the brand mark, a branded favicon, the
 * light/dark theme toggle, and the modal host used for "new entry" popups.
 * Theme + modal behaviour is a small amount of inline JS (this is otherwise a
 * server-rendered HTMX app); the theme init runs in <head> before first paint
 * so there's no flash of the wrong scheme.
 */

import { html } from "hono/html";
import type { Html } from "./html.ts";
import { readableFg } from "../../brand/contrast.ts";
import type { BrandConfig } from "../../brand/types.ts";

const WEBFONTS: Record<string, string> = {
  inter: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
};

/** Optional <link> tags to load a selected webfont; empty for system stacks. */
export function webfontLinks(fontFamily: string): string {
  const href = WEBFONTS[fontFamily];
  if (href === undefined) return "";
  return (
    `<link rel="preconnect" href="https://fonts.googleapis.com" />` +
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />` +
    `<link rel="stylesheet" href="${href}" />`
  );
}

/**
 * The default logo glyph — a rounded tile with a "forward" arrow. Uses the
 * accent token (which inverts per theme: black on light, white on dark) for the
 * tile and the background token for the arrow, so the mark stays high-contrast
 * in both light and dark mode.
 */
function markSvg(): Html {
  return html`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" class="shrink-0">
    <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--brand-accent)" />
    <path d="M6 12h11M12.5 7.5 18 12l-5.5 4.5" stroke="var(--brand-bg)" stroke-width="2.1"
      stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

/** Brand mark: a custom logo image if set, otherwise the glyph + wordmark. */
export function brandMark(brand: BrandConfig): Html {
  if (brand.logoDark !== "") {
    return html`<img src="${brand.logoDark}" alt="${brand.productName}" class="h-6 w-auto" />`;
  }
  return html`<span class="flex items-center gap-2">
    ${markSvg()}
    <span class="text-lg font-semibold tracking-tight" style="color:var(--brand-fg)">${brand.productName}</span>
  </span>`;
}

/** A branded favicon as a data URI: the glyph baked with the primary colour. */
export function faviconTag(brand: BrandConfig): string {
  if (brand.icon !== "") return `<link rel="icon" href="${brand.icon}" />`;
  const fg = readableFg(brand.primary);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>` +
    `<rect x='1' y='1' width='22' height='22' rx='6' fill='${brand.primary}'/>` +
    `<path d='M6 12h11M12.5 7.5 18 12l-5.5 4.5' stroke='${fg}' stroke-width='2.1' ` +
    `fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
  return `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg)}" />`;
}

/** Light/dark toggle. Its glyph/label are set by JS once the theme is known. */
export function themeToggle(): Html {
  return html`<button id="pb-theme-btn" type="button" onclick="pbToggleTheme()"
    class="inline-flex items-center justify-center px-2 py-2 text-sm hover:opacity-80"
    style="color:var(--brand-muted)" aria-label="Toggle theme" title="Toggle light / dark">☾</button>`;
}

/** The single dialog every "new entry" popup renders into. */
export function modalHost(): Html {
  return html`<dialog id="pb-modal" aria-label="Dialog">
    <button type="button" onclick="pbCloseModal()" aria-label="Close"
      class="absolute end-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded hover:opacity-80"
      style="color:var(--brand-muted)">✕</button>
    <div id="pb-modal-body"></div>
  </dialog>`;
}

// Runs in <head> before paint: apply a saved theme so there's no flash.
export const THEME_INIT_JS =
  "(function(){try{var t=localStorage.getItem('pb-theme');" +
  "if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();";

// Runs at end of <body>: theme toggle, modal open/close, HTMX modal wiring.
export const CHROME_JS =
  "function pbSysDark(){return matchMedia('(prefers-color-scheme:dark)').matches;}" +
  "function pbCurTheme(){return document.documentElement.getAttribute('data-theme')||(pbSysDark()?'dark':'light');}" +
  "function pbSyncThemeBtn(){var b=document.getElementById('pb-theme-btn');if(!b)return;" +
  "var d=pbCurTheme()==='dark';b.textContent=d?'☀':'☾';" +
  "b.setAttribute('aria-label',d?'Switch to light theme':'Switch to dark theme');}" +
  "function pbSetTheme(t){try{localStorage.setItem('pb-theme',t);}catch(e){}" +
  "document.documentElement.setAttribute('data-theme',t);pbSyncThemeBtn();}" +
  "function pbToggleTheme(){pbSetTheme(pbCurTheme()==='dark'?'light':'dark');}" +
  "function pbCloseModal(){var m=document.getElementById('pb-modal');if(m&&m.open)m.close();}" +
  "function pbOpenModal(){var m=document.getElementById('pb-modal');if(m&&!m.open)m.showModal();}" +
  "pbSyncThemeBtn();" +
  "(function(){var m=document.getElementById('pb-modal');" +
  "if(m)m.addEventListener('click',function(e){if(e.target===m)pbCloseModal();});})();" +
  "document.body.addEventListener('htmx:afterSwap',function(e){" +
  "if(e.detail&&e.detail.target&&e.detail.target.id==='pb-modal-body')pbOpenModal();});";

export const CHROME_CSS =
  "body{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}" +
  "dialog#pb-modal{position:relative;background:var(--brand-surface);color:var(--brand-fg);" +
  "border:1px solid var(--brand-border);border-radius:14px;max-width:460px;width:calc(100% - 2rem);padding:0}" +
  "dialog#pb-modal::backdrop{background:rgba(0,0,0,.55)}";
