/**
 * Derive the theme tokens (§3) from the configured primary + fixed dark
 * neutrals. Everything the UI colours with is one of these — no component holds
 * a literal brand value. Emitted as CSS custom properties injected before first
 * paint, so there's no flash of default branding.
 */

import { ensureAccessible, readableFg } from "./contrast.ts";
import { FONT_ALLOWLIST, type BrandConfig } from "./types.ts";

// The chrome neutrals are fixed (dark theme); only the accent derives from primary.
const BG = "#020617";
const AA_TEXT = 4.5;

export function deriveTokens(primary: string): Record<string, string> {
  return {
    "brand-bg": BG,
    "brand-surface": "#0f172a",
    "brand-elevated": "#111a2e",
    "brand-fg": "#f1f5f9",
    "brand-muted": "#94a3b8",
    "brand-border": "#1e293b",
    "brand-primary": primary,
    "brand-primary-fg": readableFg(primary), // readable label on a primary fill
    "brand-accent": ensureAccessible(primary, BG, AA_TEXT), // AA-legible text/links on bg
    "brand-danger": "#f87171",
    "brand-ok": "#34d399",
  };
}

export function fontStack(fontFamily: string): string {
  return FONT_ALLOWLIST[fontFamily] ?? FONT_ALLOWLIST["system"] ?? "sans-serif";
}

/** Full `<style>` payload for the document head: tokens + font var. */
export function brandStyleCss(brand: BrandConfig): string {
  const tokens = deriveTokens(brand.primary);
  const vars = Object.entries(tokens).map(([k, v]) => `--${k}:${v}`).join(";");
  return `:root{${vars};--brand-font:${fontStack(brand.fontFamily)}}`;
}
