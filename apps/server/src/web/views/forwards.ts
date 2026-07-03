import { html } from "hono/html";
import type { Forward } from "../../docker/forward-types.ts";
import type { Target } from "../../docker/containers.ts";
import type { Html } from "./html.ts";

const TTL_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "15 minutes", value: "15" },
  { label: "1 hour", value: "60" },
  { label: "8 hours", value: "480" },
  { label: "24 hours", value: "1440" },
  { label: "never", value: "never" },
];

function clientHint(host: string, hostPort: number, targetPort: number): string {
  switch (targetPort) {
    case 5432:
      return `psql -h ${host} -p ${hostPort} -U postgres`;
    case 6379:
      return `redis-cli -h ${host} -p ${hostPort}`;
    case 3306:
      return `mysql -h ${host} -P ${hostPort} -u root -p`;
    case 27017:
      return `mongosh "mongodb://${host}:${hostPort}"`;
    default:
      return `nc ${host} ${hostPort}`;
  }
}

function expiresLabel(forward: Forward, now: number): string {
  if (forward.expiresAt === "never") return "never";
  const mins = Math.max(0, Math.round((forward.expiresAt - now) / 60));
  return `${mins}m left`;
}

export function forwardError(message: string): Html {
  return html`<div class="rounded-md border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-300">
    ${message}
  </div>`;
}

function portDatalist(target: Target): Html {
  return html`<datalist id="ports">
    ${target.ports.map((p) => html`<option value="${p.port}"></option>`)}
  </datalist>`;
}

export function forwardForm(target: Target): Html {
  const firstPort = target.ports[0]?.port;
  return html`<form
    class="space-y-3 rounded-md border border-slate-800 bg-slate-900/60 p-4 text-sm"
    hx-post="/forwards"
    hx-target="#panel"
    hx-swap="innerHTML"
  >
    <div class="flex items-center justify-between">
      <h3 class="font-medium">New forward → <span class="font-mono">${target.name}</span></h3>
      <button type="button" class="text-xs text-slate-400 hover:text-slate-200"
        hx-get="/forwards/panel" hx-target="#panel" hx-swap="innerHTML">close</button>
    </div>
    <input type="hidden" name="targetId" value="${target.id}" />
    <label class="block">
      <span class="mb-1 block text-slate-400">Target port</span>
      <input name="targetPort" type="number" min="1" max="65535" required list="ports"
        value="${firstPort === undefined ? "" : String(firstPort)}"
        class="w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1" />
      ${portDatalist(target)}
    </label>
    <label class="block">
      <span class="mb-1 block text-slate-400">Host port <span class="text-slate-600">(blank = auto)</span></span>
      <input name="hostPort" type="number" min="1" max="65535" placeholder="auto"
        class="w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1" />
    </label>
    <label class="block">
      <span class="mb-1 block text-slate-400">TTL</span>
      <select name="ttl" class="w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1">
        ${TTL_OPTIONS.map((o) => html`<option value="${o.value}">${o.label}</option>`)}
      </select>
    </label>
    <label class="flex items-center gap-2 text-slate-400">
      <input type="checkbox" name="confirmNever" value="1" />
      I understand a "never" forward stays open until deleted
    </label>
    <button type="submit"
      class="rounded bg-sky-700 px-3 py-1.5 font-medium text-white hover:bg-sky-600">
      Open forward
    </button>
  </form>`;
}

export function forwardResultCard(forward: Forward, host: string): Html {
  const address = `${host}:${forward.hostPort}`;
  return html`<div class="space-y-2 rounded-md border border-emerald-900 bg-emerald-950/40 p-4 text-sm">
    <h3 class="font-medium text-emerald-300">Forward open</h3>
    <div class="flex items-center gap-2">
      <code id="fwd-addr" class="rounded bg-slate-950 px-2 py-1 font-mono text-slate-100">${address}</code>
      <button type="button" class="rounded bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700"
        onclick="navigator.clipboard.writeText('${address}')">copy</button>
    </div>
    <p class="text-slate-400">→ <span class="font-mono">${forward.targetName}:${forward.targetPort}</span> on ${forward.network}</p>
    <pre class="overflow-x-auto rounded bg-slate-950 px-3 py-2 text-xs text-slate-300">${clientHint(host, forward.hostPort, forward.targetPort)}</pre>
  </div>`;
}

function extendControl(forward: Forward): Html {
  return html`<form
    class="flex items-center gap-1"
    hx-post="/forwards/${forward.id}/extend"
    hx-target="#panel"
    hx-swap="innerHTML"
    title="Extend recreates the sidecar — expect a brief connection blip."
  >
    <select name="ttl" class="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-xs">
      <option value="15">15m</option>
      <option value="60" selected>1h</option>
      <option value="480">8h</option>
      <option value="1440">24h</option>
    </select>
    <button class="text-xs text-sky-400 hover:text-sky-300">extend</button>
  </form>`;
}

function forwardRow(forward: Forward, host: string, now: number): Html {
  return html`<tr class="border-b border-slate-900">
    <td class="py-2 pr-4 font-mono">${host}:${forward.hostPort}</td>
    <td class="py-2 pr-4 font-mono text-slate-300">${forward.targetName}:${forward.targetPort}</td>
    <td class="py-2 pr-4 text-slate-400">${forward.network}</td>
    <td class="py-2 pr-4 text-slate-400">${expiresLabel(forward, now)}</td>
    <td class="py-2 pr-2">${extendControl(forward)}</td>
    <td class="py-2 pr-2">
      <a class="text-xs text-slate-400 hover:text-slate-200" href="/forwards/${forward.id}/logs" target="_blank">logs</a>
    </td>
    <td class="py-2">
      <button class="text-xs text-red-400 hover:text-red-300"
        hx-post="/forwards/${forward.id}/delete" hx-target="#panel" hx-swap="innerHTML"
        hx-confirm="Delete this forward?">delete</button>
    </td>
  </tr>`;
}

export function managedForwardsTable(forwards: readonly Forward[], host: string, now: number): Html {
  if (forwards.length === 0) {
    return html`<div class="rounded-md border border-slate-800 bg-slate-900/50 px-4 py-6 text-sm text-slate-400">
      No active forwards.
    </div>`;
  }
  return html`<table class="w-full border-collapse text-sm">
    <thead>
      <tr class="border-b border-slate-800 text-left text-slate-400">
        <th class="py-2 pr-4 font-medium">Address</th>
        <th class="py-2 pr-4 font-medium">Target</th>
        <th class="py-2 pr-4 font-medium">Network</th>
        <th class="py-2 pr-4 font-medium">Expires</th>
        <th class="py-2 pr-2 font-medium"></th>
        <th class="py-2 pr-2 font-medium"></th>
        <th class="py-2 font-medium"></th>
      </tr>
    </thead>
    <tbody>
      ${forwards.map((f) => forwardRow(f, host, now))}
    </tbody>
  </table>`;
}
