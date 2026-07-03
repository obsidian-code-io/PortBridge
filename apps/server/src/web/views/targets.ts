import { html } from "hono/html";
import type { Target, PortInfo, NetworkInfo } from "../../docker/containers.ts";
import type { Html } from "./html.ts";

const EMPTY_BOX =
  "rounded-md border border-slate-800 bg-slate-900/50 px-4 py-6 text-sm text-slate-400";

export function errorBanner(message: string): Html {
  return html`<div class="rounded-md border border-red-900 bg-red-950/60 px-4 py-4 text-sm text-red-300">
    ${message}
  </div>`;
}

function stateBadge(state: string): Html {
  const cls =
    state === "running"
      ? "bg-emerald-900/60 text-emerald-300"
      : "bg-slate-800 text-slate-400";
  return html`<span class="rounded px-2 py-0.5 text-xs ${cls}">${state}</span>`;
}

function networkChip(net: NetworkInfo): Html {
  return html`<span class="mr-1 inline-block rounded bg-slate-800 px-1.5 py-0.5 text-xs">${net.name}</span>`;
}

function portChip(p: PortInfo): Html {
  // Don't convey published/internal by colour alone (WCAG): published adds "↗".
  if (p.published) {
    return html`<span title="published on host" class="mr-1 inline-block rounded border px-1.5 py-0.5 text-xs"
      style="color:var(--brand-accent);border-color:var(--brand-accent)">${p.port}/tcp ↗</span>`;
  }
  return html`<span title="internal only" class="mr-1 inline-block rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">${p.port}/tcp</span>`;
}

function cell<T>(items: readonly T[], empty: string, render: (x: T) => Html): Html {
  if (items.length === 0) return html`<span class="text-slate-600">${empty}</span>`;
  return html`${items.map(render)}`;
}

function forwardAction(target: Target): Html {
  return html`<button
    class="rounded bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700"
    hx-get="/forwards/new?target=${target.id}"
    hx-target="#panel"
    hx-swap="innerHTML"
  >forward</button>`;
}

function targetRow(target: Target): Html {
  return html`<tr class="border-b border-slate-900 hover:bg-slate-900/40">
    <td class="py-2 pr-4 font-mono">${target.name}</td>
    <td class="py-2 pr-4 text-slate-300">${target.image}</td>
    <td class="py-2 pr-4">${stateBadge(target.state)}</td>
    <td class="py-2 pr-4 text-slate-300">${cell(target.networks, "—", networkChip)}</td>
    <td class="py-2 pr-4">${cell(target.ports, "none exposed", portChip)}</td>
    <td class="py-2 text-right">${forwardAction(target)}</td>
  </tr>`;
}

export function targetsTable(targets: readonly Target[]): Html {
  if (targets.length === 0) {
    return html`<div class="${EMPTY_BOX}">No matching containers.</div>`;
  }
  return html`<table class="w-full border-collapse text-sm">
    <thead>
      <tr class="border-b border-slate-800 text-left text-slate-400">
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
