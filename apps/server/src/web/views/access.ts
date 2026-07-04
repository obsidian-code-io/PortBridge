/**
 * Roles & Access admin UI. Roles and keys are created through the shared modal
 * popup (consistent with the rest of the app); an issued key's plaintext is
 * shown exactly once. Tables reload on the `rolesChanged` / `keysChanged`
 * events the routes emit after a mutation.
 */

import { html } from "hono/html";
import type { Html } from "./html.ts";
import type { BrandConfig } from "../../brand/types.ts";
import type { ApiKeyRecord, Role, RoleScope } from "../../access/types.ts";
import { layout } from "./layout.ts";
import { field, selectField } from "./brand-form.ts";
import { S_BORDER, S_BOX, S_CHIP, S_DANGER, S_MUTED } from "./styles.ts";

function scopeSummary(s: RoleScope): string {
  const ports = s.allPorts ? "all ports" : s.ports.length ? `ports ${s.ports.join(", ")}` : "no ports";
  const containers = s.allContainers ? "all containers" : s.containers.length ? `containers ${s.containers.join(", ")}` : "no containers";
  return `${ports} · ${containers}`;
}

function primaryBtn(label: string, attrs: Html): Html {
  return html`<button ${attrs} class="rounded-md px-3 py-2 text-sm font-medium hover:opacity-90"
    style="background:var(--brand-primary);color:var(--brand-primary-fg);min-height:44px">${label}</button>`;
}

export function roleForm(error?: string): Html {
  return html`<form hx-post="/access/roles" hx-target="#pb-modal-body" hx-swap="innerHTML" class="space-y-3 p-5 text-sm">
    <h3 class="text-base font-semibold">New role</h3>
    ${error !== undefined ? html`<div class="rounded-md border px-3 py-2" style="${S_DANGER}">${error}</div>` : ""}
    ${field("name", "Role name", "", { placeholder: "db-readers" })}
    <label class="flex items-center gap-2" style="${S_MUTED}">
      <input type="checkbox" name="allPorts" value="1" class="h-6 w-6 shrink-0" style="accent-color:var(--brand-primary)" /> Allow all ports
    </label>
    ${field("ports", "Allowed ports", "", { placeholder: "5432, 6379", hint: "Comma-separated. Ignored if 'all ports' is on." })}
    <label class="flex items-center gap-2" style="${S_MUTED}">
      <input type="checkbox" name="allContainers" value="1" class="h-6 w-6 shrink-0" style="accent-color:var(--brand-primary)" /> Allow all containers
    </label>
    ${field("containers", "Allowed containers", "", { placeholder: "postgres, redis", hint: "Comma-separated container names." })}
    ${primaryBtn("Create role", html`type="submit"`)}
  </form>`;
}

export function keyForm(roles: readonly Role[], error?: string): Html {
  if (roles.length === 0) {
    return html`<div class="space-y-3 p-5 text-sm">
      <h3 class="text-base font-semibold">Issue API key</h3>
      <p style="${S_MUTED}">Create a role first, then issue a key bound to it.</p>
    </div>`;
  }
  const opts = roles.map((r) => ({ value: r.id, label: r.name }));
  return html`<form hx-post="/access/keys" hx-target="#pb-modal-body" hx-swap="innerHTML" class="space-y-3 p-5 text-sm">
    <h3 class="text-base font-semibold">Issue API key</h3>
    ${error !== undefined ? html`<div class="rounded-md border px-3 py-2" style="${S_DANGER}">${error}</div>` : ""}
    ${field("label", "Party / user label", "", { placeholder: "alice@example.com" })}
    ${selectField("roleId", "Role", opts[0]?.value ?? "", opts)}
    ${primaryBtn("Issue key", html`type="submit"`)}
  </form>`;
}

export function keyCreatedCard(plaintext: string): Html {
  return html`<div class="space-y-3 p-5 text-sm">
    <h3 class="text-base font-semibold" style="color:var(--brand-ok)">✓ API key issued</h3>
    <p style="${S_MUTED}">Copy it now — it is shown only once and cannot be retrieved again.</p>
    <div class="flex items-center gap-2">
      <code class="grow overflow-x-auto rounded px-2 py-1 font-mono" style="${S_CHIP}">${plaintext}</code>
      <button type="button" class="rounded px-2 py-1 text-xs hover:opacity-80" style="${S_CHIP}"
        onclick="navigator.clipboard.writeText('${plaintext}')">copy</button>
    </div>
    ${primaryBtn("Done", html`type="button" onclick="pbCloseModal()"`)}
  </div>`;
}

export function rolesTable(roles: readonly Role[]): Html {
  if (roles.length === 0) return html`<div class="rounded-md border px-4 py-6 text-sm" style="${S_BOX}">No roles yet.</div>`;
  return html`<table class="w-full border-collapse text-sm">
    <thead><tr class="border-b text-left" style="${S_BORDER};${S_MUTED}">
      <th class="py-2 pr-4 font-medium">Role</th><th class="py-2 pr-4 font-medium">Scope</th><th class="py-2 font-medium"></th>
    </tr></thead>
    <tbody>${roles.map((r) => html`<tr class="pb-row border-b" style="${S_BORDER}">
      <td class="py-2 pr-4 font-medium">${r.name}</td>
      <td class="py-2 pr-4" style="${S_MUTED}">${scopeSummary(r.scope)}</td>
      <td class="py-2 text-right"><button class="text-xs hover:opacity-80" style="color:var(--brand-danger)"
        hx-post="/access/roles/${r.id}/delete" hx-target="#access-msg" hx-swap="innerHTML"
        hx-confirm="Delete role '${r.name}'?">delete</button></td>
    </tr>`)}</tbody>
  </table>`;
}

function keyRow(k: ApiKeyRecord, roleName: string): Html {
  const revoked = k.revokedAt !== null;
  return html`<tr class="pb-row border-b" style="${S_BORDER}">
    <td class="py-2 pr-4 font-medium">${k.label}</td>
    <td class="py-2 pr-4" style="${S_MUTED}">${roleName}</td>
    <td class="py-2 pr-4 font-mono" style="${S_MUTED}">${k.prefix}…</td>
    <td class="py-2 text-right">${revoked
      ? html`<span class="text-xs" style="${S_MUTED}">revoked</span>`
      : html`<button class="text-xs hover:opacity-80" style="color:var(--brand-danger)"
          hx-post="/access/keys/${k.id}/revoke" hx-target="#access-msg" hx-swap="innerHTML"
          hx-confirm="Revoke this key? Any client using it stops working immediately.">revoke</button>`}</td>
  </tr>`;
}

export function keysTable(keys: readonly ApiKeyRecord[], roles: readonly Role[]): Html {
  if (keys.length === 0) return html`<div class="rounded-md border px-4 py-6 text-sm" style="${S_BOX}">No API keys yet.</div>`;
  const name = (id: string): string => roles.find((r) => r.id === id)?.name ?? "—";
  return html`<table class="w-full border-collapse text-sm">
    <thead><tr class="border-b text-left" style="${S_BORDER};${S_MUTED}">
      <th class="py-2 pr-4 font-medium">Party</th><th class="py-2 pr-4 font-medium">Role</th>
      <th class="py-2 pr-4 font-medium">Key</th><th class="py-2 font-medium"></th>
    </tr></thead>
    <tbody>${keys.map((k) => keyRow(k, name(k.roleId)))}</tbody>
  </table>`;
}

function section(title: string, desc: string, tableId: string, tablePath: string, newBtn: Html): Html {
  return html`<section class="mb-8">
    <div class="mb-3 flex items-center justify-between">
      <div><h2 class="text-lg font-semibold">${title}</h2><p class="text-sm" style="${S_MUTED}">${desc}</p></div>
      ${newBtn}
    </div>
    <div id="${tableId}" hx-get="${tablePath}" hx-trigger="load, ${tableId}Changed from:body" hx-swap="innerHTML"></div>
  </section>`;
}

export function accessPage(brand: BrandConfig, csrf: string): Html {
  const newRole = html`<button class="rounded-md px-3 py-2 text-sm font-medium hover:opacity-90"
    style="background:var(--brand-primary);color:var(--brand-primary-fg);min-height:44px"
    hx-get="/access/roles/new" hx-target="#pb-modal-body" hx-swap="innerHTML">New role</button>`;
  const newKey = html`<button class="rounded-md px-3 py-2 text-sm font-medium hover:opacity-90"
    style="background:var(--brand-primary);color:var(--brand-primary-fg);min-height:44px"
    hx-get="/access/keys/new" hx-target="#pb-modal-body" hx-swap="innerHTML">Issue key</button>`;
  const body = html`<div>
    <div id="access-msg" class="mb-3 empty:mb-0"></div>
    ${section("Roles", "Scope who may forward which ports and containers.", "access-roles", "/access/roles/table", newRole)}
    ${section("API keys", "One key per party; each carries a role. Shown once on creation.", "access-keys", "/access/keys/table", newKey)}
  </div>`;
  return layout("Roles & Access", body, { brand, csrf, admin: true });
}
