import { html } from "hono/html";
import type { AuditRow } from "../../audit/types.ts";
import type { BrandConfig } from "../../brand/types.ts";
import type { Html } from "./html.ts";
import { layout } from "./layout.ts";
import { S_BORDER, S_BOX, S_MUTED, S_SURFACE } from "./styles.ts";

const ACTIONS: readonly string[] = [
  "forward_created", "forward_deleted", "forward_expired", "forward_extend",
  "reconciled_missing", "create_failed", "login_ok", "login_fail",
];

function fmtTime(at: number): string {
  return new Date(at * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function dash(value: string | null): string {
  return value === null || value === "" ? "—" : value;
}

function filterBar(selected: string | undefined): Html {
  return html`<form method="get" action="/audit" class="mb-3 flex items-center gap-2 text-sm">
    <label style="${S_MUTED}">Action</label>
    <select name="action" onchange="this.form.submit()"
      class="rounded border px-2 py-1" style="${S_SURFACE}">
      <option value="" ${selected === undefined ? "selected" : ""}>all</option>
      ${ACTIONS.map((a) => html`<option value="${a}" ${a === selected ? "selected" : ""}>${a}</option>`)}
    </select>
  </form>`;
}

function auditRow(row: AuditRow): Html {
  return html`<tr class="pb-row border-b" style="${S_BORDER}">
    <td class="py-1.5 pr-4 font-mono" style="${S_MUTED}">${fmtTime(row.at)}</td>
    <td class="py-1.5 pr-4">${row.action}</td>
    <td class="py-1.5 pr-4" style="${S_MUTED}">${dash(row.actor)}</td>
    <td class="py-1.5 pr-4 font-mono" style="${S_MUTED}">${dash(row.forward_id).slice(0, 12)}</td>
    <td class="py-1.5 pr-4" style="${S_MUTED}">${dash(row.target_name)}:${dash(row.target_port)}</td>
    <td class="py-1.5 pr-4" style="${S_MUTED}">${dash(row.host_port)}</td>
    <td class="py-1.5" style="${S_MUTED}">${dash(row.detail)}</td>
  </tr>`;
}

function auditTable(rows: readonly AuditRow[]): Html {
  if (rows.length === 0) {
    return html`<div class="rounded-md border px-4 py-6 text-sm" style="${S_BOX}">No audit entries.</div>`;
  }
  return html`<table class="w-full border-collapse text-sm">
    <thead>
      <tr class="border-b text-left" style="${S_BORDER};${S_MUTED}">
        <th class="py-2 pr-4 font-medium">Time (UTC)</th>
        <th class="py-2 pr-4 font-medium">Action</th>
        <th class="py-2 pr-4 font-medium">Actor</th>
        <th class="py-2 pr-4 font-medium">Forward</th>
        <th class="py-2 pr-4 font-medium">Target</th>
        <th class="py-2 pr-4 font-medium">Host</th>
        <th class="py-2 font-medium">Detail</th>
      </tr>
    </thead>
    <tbody>${rows.map(auditRow)}</tbody>
  </table>`;
}

export function auditPage(
  rows: readonly AuditRow[],
  selected: string | undefined,
  brand: BrandConfig,
  csrf: string,
  admin: boolean,
): Html {
  const body = html`<section>
    <h2 class="mb-3 text-lg font-medium">Audit log <span class="text-xs" style="${S_MUTED}">(last 500)</span></h2>
    ${filterBar(selected)}
    ${auditTable(rows)}
  </section>`;
  return layout("Audit", body, { brand, csrf, admin });
}
