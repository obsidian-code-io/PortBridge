/**
 * Brand config store — single-tenant (one record). Persists to SQLite, caches
 * in memory and invalidates on save so updates apply without a redeploy (§3).
 * Onboarding and Settings both go through here — one source of truth, two
 * surfaces (parity, §2). `save` validates the primary colour against WCAG AA.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio, parseHex, readableFg } from "./contrast.ts";
import { BRAND_DEFAULTS, FONT_ALLOWLIST, type BrandConfig, type BrandInput } from "./types.ts";

const AA_UI = 3; // primary must be distinguishable from the background
const AA_TEXT = 4.5; // a readable label must exist on a primary fill

export class BrandValidationError extends Error {
  override readonly name = "BrandValidationError";
  constructor(readonly issues: string[]) {
    super(issues.join(" "));
  }
}

/** Returns human-readable issues; empty array = valid. `bg` is the effective background. */
export function validateBrand(input: BrandInput, bg: string = BRAND_DEFAULTS.background): string[] {
  const issues: string[] = [];
  if (input.background !== undefined && parseHex(input.background) === undefined) {
    issues.push(`Background colour "${input.background}" is not a valid hex colour.`);
  }
  if (input.primary !== undefined) {
    if (parseHex(input.primary) === undefined) {
      issues.push(`Primary colour "${input.primary}" is not a valid hex colour.`);
    } else {
      if (contrastRatio(input.primary, bg) < AA_UI) {
        issues.push(`Primary colour is too low-contrast against the background (needs ≥ ${AA_UI}:1).`);
      }
      const fgRatio = contrastRatio(input.primary, readableFg(input.primary));
      if (fgRatio < AA_TEXT) issues.push(`No readable label colour exists on that primary (needs ≥ ${AA_TEXT}:1).`);
    }
  }
  if (input.dir !== undefined && input.dir !== "ltr" && input.dir !== "rtl") issues.push(`dir must be "ltr" or "rtl".`);
  if (input.fontFamily !== undefined && FONT_ALLOWLIST[input.fontFamily] === undefined) {
    issues.push(`Font "${input.fontFamily}" is not in the allowlist.`);
  }
  return issues;
}

function merge(current: BrandConfig, input: BrandInput): BrandConfig {
  const next = { ...current, ...input };
  next.links = Array.isArray(next.links) ? next.links.filter((l) => l && l.url) : [];
  return next;
}

export class BrandStore {
  private readonly db: Database;
  private readonly insert;
  private cache: BrandConfig;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, "portbridge.db"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("CREATE TABLE IF NOT EXISTS brand_config (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);");
    this.insert = this.db.query(
      "INSERT INTO brand_config (id, data, updated_at) VALUES ('singleton', $data, $at) " +
        "ON CONFLICT(id) DO UPDATE SET data = $data, updated_at = $at",
    );
    this.cache = this.load();
  }

  private load(): BrandConfig {
    const row = this.db.query("SELECT data FROM brand_config WHERE id = 'singleton'").get() as { data: string } | null;
    if (row === null) return { ...BRAND_DEFAULTS };
    try {
      return { ...BRAND_DEFAULTS, ...(JSON.parse(row.data) as Partial<BrandConfig>) };
    } catch {
      return { ...BRAND_DEFAULTS };
    }
  }

  /** Current config (cached). */
  get(): BrandConfig {
    return this.cache;
  }

  private persist(next: BrandConfig): BrandConfig {
    this.insert.run({ $data: JSON.stringify(next), $at: Math.floor(Date.now() / 1000) });
    this.cache = next; // invalidate + refresh the cache
    return next;
  }

  /** Save editable brand fields (validated). Throws BrandValidationError. */
  save(input: BrandInput): BrandConfig {
    const bg = input.background ?? this.cache.background;
    const issues = validateBrand(input, bg);
    if (issues.length > 0) throw new BrandValidationError(issues);
    return this.persist(merge(this.cache, input));
  }

  /** Persist onboarding flow state (step / completion). */
  setOnboarding(state: { step?: number; onboarded?: boolean }): BrandConfig {
    return this.persist({
      ...this.cache,
      onboardingStep: state.step ?? this.cache.onboardingStep,
      onboarded: state.onboarded ?? this.cache.onboarded,
    });
  }
}
