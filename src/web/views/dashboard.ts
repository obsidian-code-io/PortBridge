import { html } from "hono/html";
import type { Target } from "../../docker/containers.ts";
import type { Html } from "./html.ts";
import { layout } from "./layout.ts";
import { targetsTable, errorBanner } from "./targets.ts";

function searchInput(): Html {
  return html`<input
    type="search"
    name="q"
    placeholder="filter by name or image…"
    autocomplete="off"
    class="w-64 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm outline-none focus:border-slate-500"
    hx-get="/targets"
    hx-trigger="input changed delay:200ms, search"
    hx-target="#targets"
    hx-swap="innerHTML"
  />`;
}

function managedForwardsPlaceholder(): Html {
  return html`<div class="rounded-md border border-slate-800 bg-slate-900/50 px-4 py-6 text-sm text-slate-400">
    No active forwards yet. The forward engine lands in Phase 2.
  </div>`;
}

function dashboardBody(targets: readonly Target[], error: string | undefined): Html {
  return html`<section class="mb-8">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-lg font-medium">Targets</h2>
      ${searchInput()}
    </div>
    <div id="targets">${error !== undefined ? errorBanner(error) : targetsTable(targets)}</div>
  </section>

  <section>
    <h2 class="mb-3 text-lg font-medium">Managed forwards</h2>
    ${managedForwardsPlaceholder()}
  </section>`;
}

export function dashboardPage(targets: readonly Target[], error?: string): Html {
  return layout("Dashboard", dashboardBody(targets, error));
}
