/**
 * Shared inline-style fragments built from brand tokens (§3). Views reference
 * these instead of hardcoded palette utilities, so every surface re-themes with
 * the brand background/primary — light or dark — with no literal colours.
 */

export const S_MUTED = "color:var(--brand-muted)";
export const S_FG = "color:var(--brand-fg)";
export const S_BORDER = "border-color:var(--brand-border)";
export const S_SURFACE = "background:var(--brand-surface);border-color:var(--brand-border)";
export const S_CHIP = "background:var(--brand-elevated);color:var(--brand-fg)";
export const S_CHIP_MUTED = "background:var(--brand-elevated);color:var(--brand-muted)";
export const S_BOX = "background:var(--brand-surface);border-color:var(--brand-border);color:var(--brand-muted)";
export const S_OK = "background:var(--brand-elevated);color:var(--brand-ok)";
export const S_DANGER = "background:var(--brand-surface);border-color:var(--brand-danger);color:var(--brand-danger)";
