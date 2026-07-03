import { html } from "hono/html";
import type { Forward } from "../../docker/forward-types.ts";
import type { Target } from "../../docker/containers.ts";
import type { Html } from "./html.ts";
import { S_BORDER, S_BOX, S_CHIP, S_DANGER, S_FG, S_MUTED, S_OK, S_SURFACE } from "./styles.ts";

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
  return html`<div class="rounded-md border px-4 py-3 text-sm" style="${S_DANGER}">${message}</div>`;
}

function portDatalist(target: Target): Html {
  return html`<datalist id="ports">
    ${target.ports.map((p) => html`<option value="${p.port}"></option>`)}
  </datalist>`;
}

export function forwardForm(target: Target): Html {
  const firstPort = target.ports[0]?.port;
  const input = "w-40 rounded border px-2 py-1";
  return html`<form
    class="space-y-3 rounded-md border p-4 text-sm"
    style="${S_SURFACE}"
    hx-post="/forwards"
    hx-target="#panel"
    hx-swap="innerHTML"
  >
    <div class="flex items-center justify-between">
      <h3 class="font-medium">New forward → <span class="font-mono">${target.name}</span></h3>
      <button type="button" class="text-xs hover:opacity-80" style="${S_MUTED}"
        hx-get="/forwards/panel" hx-target="#panel" hx-swap="innerHTML">close</button>
    </div>
    <input type="hidden" name="targetId" value="${target.id}" />
    <label class="block">
      <span class="mb-1 block" style="${S_MUTED}">Target port</span>
      <input name="targetPort" type="number" min="1" max="65535" required list="ports"
        value="${firstPort === undefined ? "" : String(firstPort)}"
        class="${input}" style="${S_SURFACE}" />
      ${portDatalist(target)}
    </label>
    <label class="block">
      <span class="mb-1 block" style="${S_MUTED}">Host port <span style="${S_MUTED}">(blank = auto)</span></span>
      <input name="hostPort" type="number" min="1" max="65535" placeholder="auto"
        class="${input}" style="${S_SURFACE}" />
    </label>
    <label class="block">
      <span class="mb-1 block" style="${S_MUTED}">TTL</span>
      <select name="ttl" class="${input}" style="${S_SURFACE}">
        ${TTL_OPTIONS.map((o) => html`<option value="${o.value}">${o.label}</option>`)}
      </select>
    </label>
    <label class="flex items-center gap-2" style="${S_MUTED}">
      <input type="checkbox" name="confirmNever" value="1" />
      I understand a "never" forward stays open until deleted
    </label>
    <button type="submit"
      class="rounded px-3 py-1.5 font-medium hover:opacity-90"
      style="background:var(--brand-primary);color:var(--brand-primary-fg)">
      Open forward
    </button>
  </form>`;
}

export function forwardResultCard(forward: Forward, host: string): Html {
  // Result cards are only rendered for tcp forwards (which always have a host port).
  const hostPort = forward.hostPort ?? 0;
  const address = `${host}:${hostPort}`;
  return html`<div class="space-y-2 rounded-md border p-4 text-sm" style="background:var(--brand-surface);border-color:var(--brand-ok)">
    <h3 class="font-medium" style="color:var(--brand-ok)">Forward open</h3>
    <div class="flex items-center gap-2">
      <code id="fwd-addr" class="rounded px-2 py-1 font-mono" style="${S_CHIP}">${address}</code>
      <button type="button" class="rounded px-2 py-1 text-xs hover:opacity-80" style="${S_CHIP}"
        onclick="navigator.clipboard.writeText('${address}')">copy</button>
    </div>
    <p style="${S_MUTED}">→ <span class="font-mono">${forward.targetName}:${forward.targetPort}</span> on ${forward.network}</p>
    <pre class="overflow-x-auto rounded px-3 py-2 text-xs" style="${S_CHIP}">${clientHint(host, hostPort, forward.targetPort)}</pre>
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
    <select name="ttl" class="rounded border px-1 py-0.5 text-xs" style="${S_SURFACE}">
      <option value="15">15m</option>
      <option value="60" selected>1h</option>
      <option value="480">8h</option>
      <option value="1440">24h</option>
    </select>
    <button class="text-xs hover:opacity-80" style="color:var(--brand-accent)">extend</button>
  </form>`;
}

function addressCell(forward: Forward, host: string): Html {
  if (forward.kind === "agent-tunnel" || forward.hostPort === null) {
    return html`<span class="rounded px-2 py-0.5 text-xs" style="background:var(--brand-elevated);color:var(--brand-accent)" title="tunnelled to a laptop over an outbound WebSocket">via agent</span>`;
  }
  return html`<span class="font-mono">${host}:${forward.hostPort}</span>`;
}

function killButton(forward: Forward, tcp: boolean): Html {
  return html`<button
    class="text-xs hover:opacity-80"
    style="color:var(--brand-danger)"
    hx-post="/forwards/${forward.id}/delete"
    hx-target="#panel"
    hx-swap="innerHTML"
    hx-confirm="${tcp ? "Delete this forward?" : "Kill this tunnel?"}"
  >${tcp ? "delete" : "kill"}</button>`;
}

function forwardRow(forward: Forward, host: string, now: number): Html {
  const tcp = forward.kind === "tcp";
  return html`<tr class="pb-row border-b" style="${S_BORDER}">
    <td class="py-2 pr-4">${addressCell(forward, host)}</td>
    <td class="py-2 pr-4 font-mono" style="${S_FG}">${forward.targetName}:${forward.targetPort}</td>
    <td class="py-2 pr-4" style="${S_MUTED}">${forward.network}</td>
    <td class="py-2 pr-4" style="${S_MUTED}">${expiresLabel(forward, now)}</td>
    <td class="py-2 pr-2">${tcp ? extendControl(forward) : html``}</td>
    <td class="py-2 pr-2">
      ${tcp
        ? html`<a class="text-xs hover:opacity-80" style="${S_MUTED}" href="/forwards/${forward.id}/logs" target="_blank">logs</a>`
        : html`<span class="text-xs" style="${S_MUTED}">via agent</span>`}
    </td>
    <td class="py-2">${killButton(forward, tcp)}</td>
  </tr>`;
}

export function managedForwardsTable(forwards: readonly Forward[], host: string, now: number): Html {
  if (forwards.length === 0) {
    return html`<div class="rounded-md border px-4 py-6 text-sm" style="${S_BOX}">
      No active forwards. Open a TCP forward above, or reach a cloud container from your laptop:
      <code class="rounded px-1.5 py-0.5 text-xs" style="${S_CHIP}">portbridge tunnel &lt;target&gt; &lt;port&gt;</code>
    </div>`;
  }
  return html`<table class="w-full border-collapse text-sm">
    <thead>
      <tr class="border-b text-left" style="${S_BORDER};${S_MUTED}">
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
