import { html } from "hono/html";
import type { Target } from "../../docker/containers.ts";
import type { BrandConfig } from "../../brand/types.ts";
import type { Html } from "./html.ts";
import { layout } from "./layout.ts";
import { targetsTable, errorBanner } from "./targets.ts";

function searchInput(): Html {
  return html`<input
    type="search"
    name="q"
    placeholder="filter by name or image…"
    autocomplete="off"
    class="w-64 rounded-md border px-3 py-1.5 text-sm"
    style="border-color:var(--brand-border);background:var(--brand-surface);min-height:44px"
    hx-get="/targets"
    hx-trigger="input changed delay:200ms, search"
    hx-target="#targets"
    hx-swap="innerHTML"
  />`;
}

function managedForwardsSection(): Html {
  // Loads live data from /forwards/table on page load and whenever a forward
  // is created/deleted (server emits the `forwardsChanged` event).
  return html`<div
    id="managed"
    hx-get="/forwards/table"
    hx-trigger="load, forwardsChanged from:body"
    hx-swap="innerHTML"
  >
    <div class="text-sm" style="color:var(--brand-muted)">Loading forwards…</div>
  </div>`;
}

function dashboardBody(targets: readonly Target[], error: string | undefined): Html {
  return html`<div id="panel" class="mb-8 empty:mb-0"></div>

  <section class="mb-8">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-lg font-medium">Targets</h2>
      ${searchInput()}
    </div>
    <div id="targets">${error !== undefined ? errorBanner(error) : targetsTable(targets)}</div>
  </section>

  <section>
    <h2 class="mb-3 text-lg font-medium">Managed forwards</h2>
    ${managedForwardsSection()}
  </section>`;
}

export function dashboardPage(
  targets: readonly Target[],
  brand: BrandConfig,
  csrf: string,
  admin: boolean,
  error?: string,
): Html {
  return layout("Dashboard", dashboardBody(targets, error), { brand, csrf, admin });
}
