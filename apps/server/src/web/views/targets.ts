import { html } from "hono/html";
import type { Target, PortInfo, NetworkInfo } from "../../docker/containers.ts";
import type { Html } from "./html.ts";
import { S_BOX, S_CHIP, S_CHIP_MUTED, S_DANGER, S_FG, S_MUTED, S_OK, S_BORDER } from "./styles.ts";

export function errorBanner(message: string): Html {
  return html`<div class="rounded-md border px-4 py-4 text-sm" style="${S_DANGER}">${message}</div>`;
}

function stateBadge(state: string): Html {
  const style = state === "running" ? S_OK : S_CHIP_MUTED;
  return html`<span class="rounded px-2 py-0.5 text-xs" style="${style}">${state}</span>`;
}

function networkChip(net: NetworkInfo): Html {
  return html`<span class="mr-1 inline-block rounded px-1.5 py-0.5 text-xs" style="${S_CHIP}">${net.name}</span>`;
}

function portChip(p: PortInfo): Html {
  // Don't convey published/internal by colour alone (WCAG): published adds "↗".
  if (p.published) {
    return html`<span title="published on host" class="mr-1 inline-block rounded border px-1.5 py-0.5 text-xs"
      style="color:var(--brand-accent);border-color:var(--brand-accent)">${p.port}/tcp ↗</span>`;
  }
  return html`<span title="internal only" class="mr-1 inline-block rounded px-1.5 py-0.5 text-xs" style="${S_CHIP}">${p.port}/tcp</span>`;
}

function cell<T>(items: readonly T[], empty: string, render: (x: T) => Html): Html {
  if (items.length === 0) return html`<span style="${S_MUTED}">${empty}</span>`;
  return html`${items.map(render)}`;
}

function forwardAction(target: Target): Html {
  // Loads the create form into the shared modal host; chrome JS opens it on swap.
  return html`<button
    class="rounded px-2 py-1 text-xs hover:opacity-80"
    style="${S_CHIP}"
    hx-get="/forwards/new?target=${target.id}"
    hx-target="#pb-modal-body"
    hx-swap="innerHTML"
  >forward</button>`;
}

function targetRow(target: Target): Html {
  return html`<tr class="pb-row border-b" style="${S_BORDER}">
    <td class="py-2 pr-4 font-mono">${target.name}</td>
    <td class="py-2 pr-4" style="${S_FG}">${target.image}</td>
    <td class="py-2 pr-4">${stateBadge(target.state)}</td>
    <td class="py-2 pr-4" style="${S_FG}">${cell(target.networks, "—", networkChip)}</td>
    <td class="py-2 pr-4">${cell(target.ports, "none exposed", portChip)}</td>
    <td class="py-2 text-right">${forwardAction(target)}</td>
  </tr>`;
}

export function targetsTable(targets: readonly Target[]): Html {
  if (targets.length === 0) {
    return html`<div class="rounded-md border px-4 py-6 text-sm" style="${S_BOX}">No matching containers.</div>`;
  }
  return html`<table class="w-full border-collapse text-sm">
    <thead>
      <tr class="border-b text-left" style="${S_BORDER};${S_MUTED}">
        <th class="py-2 pr-4 font-medium">Name</th>
        <th class="py-2 pr-4 font-medium">Image</th>
        <th class="py-2 pr-4 font-medium">State</th>
        <th class="py-2 pr-4 font-medium">Networks</th>
        <th class="py-2 pr-4 font-medium">Ports</th>
        <th class="py-2 font-medium"></th>
      </tr>
    </thead>
    <tbody>
      ${targets.map(targetRow)}
    </tbody>
  </table>`;
}
