/**
 * WCAG contrast utilities — the measurable basis for "validate on save" (§3)
 * and the a11y thresholds in §4. Pure functions, fully testable.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function parseHex(hex: string): Rgb | undefined {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) return undefined;
  let h = match[1] ?? "";
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = Number.parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(rgb: Rgb): number {
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio (1–21); 0 if either colour is unparseable. */
export function contrastRatio(a: string, b: string): number {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (ra === undefined || rb === undefined) return 0;
  const la = luminance(ra);
  const lb = luminance(rb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white — whichever is more readable as text ON `bg`. */
export function readableFg(bg: string): string {
  return contrastRatio(bg, "#ffffff") >= contrastRatio(bg, "#000000") ? "#ffffff" : "#000000";
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/**
 * Return `color` if it already meets `minRatio` against `bg`, otherwise lighten
 * it toward white until it does (so a legit-but-dim brand colour still yields an
 * accessible text/accent token instead of being rejected outright).
 */
export function ensureAccessible(color: string, bg: string, minRatio: number): string {
  const rgb = parseHex(color);
  if (rgb === undefined) return color;
  const white: Rgb = { r: 255, g: 255, b: 255 };
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const candidate = toHex(mix(rgb, white, t));
    if (contrastRatio(candidate, bg) >= minRatio) return candidate;
  }
  return "#ffffff";
}
