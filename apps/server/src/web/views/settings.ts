import { html } from "hono/html";
import type { Html } from "./html.ts";
import type { BrandConfig } from "../../brand/types.ts";
import { layout } from "./layout.ts";
import { allBrandFields } from "./brand-form.ts";

interface Notice {
  readonly kind: "ok" | "error";
  readonly text: string;
}

/** The editable form + optional notice — the swap target for POST /settings. */
export function settingsForm(brand: BrandConfig, notice?: Notice): Html {
  const noticeColor = notice?.kind === "ok" ? "var(--brand-ok)" : "var(--brand-danger)";
  return html`<div>
    ${notice !== undefined
      ? html`<div class="mb-4 rounded-md border px-3 py-2 text-sm" style="border-color:${noticeColor};color:${noticeColor}">${notice.text}</div>`
      : ""}
    <form hx-post="/settings" hx-target="#settings" hx-swap="innerHTML" class="space-y-4">
      ${allBrandFields(brand)}
      <button type="submit" class="rounded-md px-4 py-2 text-sm font-medium hover:opacity-90"
        style="background:var(--brand-primary);color:var(--brand-primary-fg);min-height:44px">Save branding</button>
    </form>
  </div>`;
}

export function settingsPage(brand: BrandConfig, csrf: string, notice?: Notice): Html {
  const body = html`<section class="max-w-xl">
    <h2 class="text-lg font-semibold">Branding</h2>
    <p class="mb-5 text-sm" style="color:var(--brand-muted)">Re-skin the app for your workspace. Changes apply immediately.</p>
    <div id="settings">${settingsForm(brand, notice)}</div>
  </section>`;
  return layout("Settings", body, { brand, csrf });
}
