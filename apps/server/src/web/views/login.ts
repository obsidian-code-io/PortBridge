import { html } from "hono/html";
import type { Html } from "./html.ts";
import { layout } from "./layout.ts";

function loginBody(error: string | undefined): Html {
  return html`<div class="mx-auto mt-16 max-w-sm">
    <h2 class="mb-4 text-lg font-medium">Sign in</h2>
    ${error !== undefined
      ? html`<div class="mb-3 rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">${error}</div>`
      : ""}
    <form method="post" action="/login" class="space-y-3">
      <label class="block text-sm">
        <span class="mb-1 block text-slate-400">Admin token</span>
        <input
          type="password"
          name="token"
          autocomplete="current-password"
          required
          class="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <button type="submit" class="w-full rounded-md bg-sky-700 px-3 py-2 font-medium text-white hover:bg-sky-600">
        Sign in
      </button>
    </form>
  </div>`;
}

export function loginPage(error?: string): Html {
  return layout("Sign in", loginBody(error));
}
