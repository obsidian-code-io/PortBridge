/**
 * Local CLI config at ~/.portbridge/config.json (mode 0600). Stores the server
 * URL and admin token. The token is never logged.
 *
 * Resolution order (so the user can set the URL themselves):
 *   --url flag  →  PORTBRIDGE_URL env  →  config.json
 * Token: PORTBRIDGE_TOKEN env  →  config.json
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export class CliError extends Error {
  override readonly name = "CliError";
}

export interface StoredConfig {
  url?: string;
  token?: string;
}

// Resolved per call so $HOME overrides take effect (and tests can isolate).
// Prefer the env home (POSIX $HOME / Windows %USERPROFILE%) because some
// runtimes cache os.homedir().
function homeDir(): string {
  return process.env["HOME"] ?? process.env["USERPROFILE"] ?? homedir();
}

function dir(): string {
  return join(homeDir(), ".portbridge");
}

export function configPath(): string {
  return join(dir(), "config.json");
}

export function readConfig(): StoredConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    const rec = parsed as Record<string, unknown>;
    return {
      url: typeof rec["url"] === "string" ? rec["url"] : undefined,
      token: typeof rec["token"] === "string" ? rec["token"] : undefined,
    };
  } catch {
    return {};
  }
}

export function writeConfig(config: StoredConfig): void {
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(configPath(), 0o600); // enforce even if the file pre-existed
}

export function clearConfig(): void {
  if (existsSync(configPath())) rmSync(configPath());
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function resolveUrl(flag?: string): string {
  const url = flag ?? process.env["PORTBRIDGE_URL"] ?? readConfig().url;
  if (url === undefined || url === "") {
    throw new CliError("No server URL. Set one: `portbridge config set-url <url>`, $PORTBRIDGE_URL, or --url.");
  }
  return stripSlash(url);
}

export function resolveToken(): string {
  const token = process.env["PORTBRIDGE_TOKEN"] ?? readConfig().token;
  if (token === undefined || token === "") {
    throw new CliError("Not logged in. Run `portbridge login`.");
  }
  return token;
}
