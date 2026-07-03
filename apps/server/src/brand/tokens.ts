/**
 * Derive the theme tokens (§3) from the configured background + primary.
 * The whole neutral palette is computed from the background, so the same code
 * yields a coherent light OR dark theme — nothing is hardcoded to one mode, and
 * no component holds a literal brand value. Emitted as CSS custom properties
 * injected before first paint, so there's no flash of default branding.
 */

import { blend, ensureReadable, readableFg } from "./contrast.ts";
import { FONT_ALLOWLIST, type BrandConfig } from "./types.ts";

const AA_TEXT = 4.5;

// Neutrals are `background` blended toward its readable foreground by fixed
// steps: small steps give surfaces/borders, large steps give body/muted text.
export function deriveTokens(background: string, primary: string): Record<string, string> {
  const fg = readableFg(background);
  // Text tokens are ensured against the *most extreme* surface they render on
  // (the elevated chip), so they clear AA on bg, surface and chips alike.
  const chip = blend(background, fg, 0.08);
  return {
    "brand-bg": background,
    "brand-surface": blend(background, fg, 0.04),
    "brand-elevated": chip,
    "brand-fg": blend(background, fg, 0.92),
    "brand-muted": ensureReadable(blend(background, fg, 0.55), chip, AA_TEXT),
    "brand-border": blend(background, fg, 0.16),
    "brand-primary": primary,
    "brand-primary-fg": readableFg(primary), // readable label on a primary fill
    "brand-accent": ensureReadable(primary, chip, AA_TEXT), // AA-legible text/links on any surface
    "brand-danger": ensureReadable("#dc2626", chip, AA_TEXT),
    "brand-ok": ensureReadable("#16a34a", chip, AA_TEXT),
  };
}

export function fontStack(fontFamily: string): string {
  return FONT_ALLOWLIST[fontFamily] ?? FONT_ALLOWLIST["system"] ?? "sans-serif";
}

/** Full `<style>` payload for the document head: tokens + font var. */
export function brandStyleCss(brand: BrandConfig): string {
  const tokens = deriveTokens(brand.background, brand.primary);
  const vars = Object.entries(tokens).map(([k, v]) => `--${k}:${v}`).join(";");
  return `:root{${vars};--brand-font:${fontStack(brand.fontFamily)}}`;
}
