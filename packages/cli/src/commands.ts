/**
 * CLI command handlers. Each stays small and delegates to tunnel-core. The
 * admin token is never printed.
 */

import { createClient, type Tunnel } from "@obsidiancode/portbridge-tunnel";
import {
  CliError,
  clearConfig,
  configPath,
  normalizeUrl,
  readConfig,
  resolveToken,
  resolveUrl,
  writeConfig,
} from "./config.ts";
import { promptHidden } from "./prompt.ts";
import { formatTargets, formatTunnels } from "./format.ts";

export interface UrlOpts {
  url?: string;
}

export function cmdConfig(action: string, value?: string): void {
  if (action === "set-url") {
    if (value === undefined) throw new CliError("Usage: portbridge config set-url <url>");
    writeConfig({ ...readConfig(), url: normalizeUrl(value) });
    console.log(`Saved server URL to ${configPath()}`);
    return;
  }
  if (action === "show") {
    const cfg = readConfig();
    console.log(`config:   ${configPath()}`);
    console.log(`url:      ${cfg.url ?? process.env["PORTBRIDGE_URL"] ?? "(unset)"}`);
    console.log(`token:    ${cfg.token ? "set" : "(unset)"}`);
    return;
  }
  throw new CliError(`Unknown config action "${action}" (expected set-url | show).`);
}

export async function cmdLogin(opts: UrlOpts): Promise<void> {
  const url = resolveUrl(opts.url);
  const token = (await promptHidden("Admin token: ")).trim();
  if (token === "") throw new CliError("No token entered.");
  writeConfig({ ...readConfig(), url, token });
  console.log(`Logged in to ${url}. Credentials saved to ${configPath()} (0600).`);
}

export function cmdLogout(): void {
  clearConfig();
  console.log("Logged out; local credentials removed.");
}

export async function cmdTargets(opts: UrlOpts): Promise<void> {
  const client = createClient({ url: resolveUrl(opts.url), token: resolveToken() });
  try {
    console.log(formatTargets(await client.targets()));
  } finally {
    client.close();
  }
}

export async function cmdLs(opts: UrlOpts): Promise<void> {
  const client = createClient({ url: resolveUrl(opts.url), token: resolveToken() });
  try {
    const tunnels = (await client.forwards()).filter((f) => f.kind === "agent-tunnel");
    console.log(formatTunnels(tunnels));
  } finally {
    client.close();
  }
}

export interface TunnelOpts extends UrlOpts {
  local?: string;
  ttl?: string;
}

function parsePort(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new CliError(`${label} must be a port between 1 and 65535 (got "${value}").`);
  }
  return n;
}

function parseTtl(ttl: string | undefined): number | "never" | undefined {
  if (ttl === undefined) return undefined;
  if (ttl === "never") return "never";
  const n = Number(ttl);
  if (!Number.isInteger(n) || n < 1) {
    throw new CliError(`--ttl must be a positive integer (minutes) or "never" (got "${ttl}").`);
  }
  return n;
}

export async function cmdTunnel(target: string, portArg: string, opts: TunnelOpts): Promise<void> {
  if (target === undefined || target === "") throw new CliError("Usage: portbridge tunnel <target> <port>");
  const targetPort = parsePort(portArg, "<port>");
  const localPort = opts.local === undefined ? undefined : parsePort(opts.local, "--local");
  const ttlMinutes = parseTtl(opts.ttl);
  const client = createClient({ url: resolveUrl(opts.url), token: resolveToken() });
  try {
    const tunnel = await client.openTunnel({ targetId: target, targetPort, localPort, ttlMinutes });
    holdTunnel(tunnel, client, target, targetPort);
  } catch (err) {
    client.close();
    throw new CliError(`Could not open tunnel: ${err instanceof Error ? err.message : err}`);
  }
}

function holdTunnel(tunnel: Tunnel, client: { close: () => void }, target: string, port: number): void {
  console.log(`→ localhost:${tunnel.localPort}  →  ${target}:${port}   (Ctrl-C to close)`);
  tunnel.on("connection", () => process.stdout.write("."));
  tunnel.on("error", (e: unknown) => console.error("\nerror:", e instanceof Error ? e.message : e));
  const shutdown = (msg?: string): void => {
    if (msg !== undefined) console.error(`\n${msg}`);
    void tunnel.close();
    client.close();
    process.exit(0);
  };
  tunnel.on("revoked", (e: { reason: string }) => shutdown(`tunnel revoked: ${e.reason}`));
  process.on("SIGINT", () => shutdown("closing tunnel"));
}
