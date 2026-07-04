/**
 * Derive the theme tokens (§3) from the configured background + primary, for
 * BOTH a light and a dark scheme. The whole neutral palette is computed from a
 * background, so the same code yields coherent light and dark themes — nothing
 * is hardcoded to one mode, and no component holds a literal brand value.
 * Emitted as CSS custom properties injected before first paint (light by
 * default, dark via prefers-color-scheme or an explicit `data-theme`).
 */

import { blend, ensureReadable, luminance, parseHex, readableFg } from "./contrast.ts";
import { FONT_ALLOWLIST, type BrandConfig } from "./types.ts";

const AA_TEXT = 4.5;

export function deriveTokens(background: string, primary: string): Record<string, string> {
  const fg = readableFg(background);
  // Text tokens are ensured against the most extreme surface they render on
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

/** Pick a light + dark base background from the single configured background. */
export function themeBackgrounds(background: string): { light: string; dark: string } {
  const rgb = parseHex(background) ?? { r: 255, g: 255, b: 255 };
  if (luminance(rgb) < 0.4) return { light: "#ffffff", dark: background };
  return { light: background, dark: blend("#0b0b0d", background, 0.05) };
}

export function fontStack(fontFamily: string): string {
  return FONT_ALLOWLIST[fontFamily] ?? FONT_ALLOWLIST["system"] ?? "sans-serif";
}

function varsFrom(tokens: Record<string, string>): string {
  return Object.entries(tokens).map(([k, v]) => `--${k}:${v}`).join(";");
}

/**
 * Full `<style>` payload for the head: light tokens on `:root`, dark tokens
 * under prefers-color-scheme (when the user hasn't chosen) and under an explicit
 * `[data-theme="dark"]`. A `[data-theme="light"]` choice falls back to `:root`.
 */
export function brandStyleCss(brand: BrandConfig): string {
  const { light, dark } = themeBackgrounds(brand.background);
  const lightVars = varsFrom(deriveTokens(light, brand.primary));
  const darkVars = varsFrom(deriveTokens(dark, brand.primary));
  const font = fontStack(brand.fontFamily);
  return (
    `:root{${lightVars};--brand-font:${font}}` +
    `@media (prefers-color-scheme:dark){:root:not([data-theme]){${darkVars}}}` +
    `:root[data-theme="dark"]{${darkVars}}`
  );
}
