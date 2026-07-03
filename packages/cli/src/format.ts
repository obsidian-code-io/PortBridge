import type { ForwardView, TargetView } from "@obsidiancode/portbridge-tunnel";

function table(headers: readonly string[], rows: readonly string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const render = (cols: readonly string[]): string => cols.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ");
  return [render(headers), ...rows.map(render)].join("\n");
}

export function formatTargets(targets: readonly TargetView[]): string {
  if (targets.length === 0) return "No containers.";
  const rows = targets.map((t) => [
    t.id,
    t.name,
    t.image,
    t.state,
    t.ports.map((p) => `${p.port}${p.published ? "*" : ""}`).join(",") || "-",
  ]);
  return table(["ID", "NAME", "IMAGE", "STATE", "PORTS"], rows);
}

function expiresLabel(expiresAt: number | "never"): string {
  if (expiresAt === "never") return "never";
  const mins = Math.max(0, Math.round((expiresAt - Math.floor(Date.now() / 1000)) / 60));
  return `${mins}m`;
}

export function formatTunnels(forwards: readonly ForwardView[]): string {
  if (forwards.length === 0) return "No active tunnels.";
  const rows = forwards.map((f) => [f.id.slice(0, 12), `${f.targetName}:${f.targetPort}`, f.network, expiresLabel(f.expiresAt)]);
  return table(["ID", "TARGET", "NETWORK", "EXPIRES"], rows);
}
