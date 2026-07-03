import { html } from "hono/html";
import type { Html } from "./html.ts";
import type { BrandConfig } from "../../brand/types.ts";
import { layout } from "./layout.ts";

function loginBody(error: string | undefined): Html {
  return html`<div class="mx-auto mt-16 max-w-sm">
    <h2 class="mb-4 text-lg font-medium">Sign in</h2>
    ${error !== undefined
      ? html`<div class="mb-3 rounded-md border px-3 py-2 text-sm" style="border-color:var(--brand-danger);color:var(--brand-danger)">${error}</div>`
      : ""}
    <form method="post" action="/login" class="space-y-3">
      <label class="block text-sm">
        <span class="mb-1 block" style="color:var(--brand-muted)">Admin token</span>
        <input
          type="password"
          name="token"
          autocomplete="current-password"
          required
          class="w-full rounded-md border px-3 py-2"
          style="border-color:var(--brand-border);background:var(--brand-surface);min-height:44px"
        />
      </label>
      <button type="submit" class="w-full rounded-md px-3 py-2 font-medium hover:opacity-90"
        style="background:var(--brand-primary);color:var(--brand-primary-fg)">
        Sign in
      </button>
    </form>
  </div>`;
}

export function loginPage(brand: BrandConfig, error?: string): Html {
  return layout("Sign in", loginBody(error), { brand, bare: true });
}
