/**
 * Brand config — the single source of truth for white-labeling (§3). Stored as
 * data, edited by onboarding and Settings, applied as tokens before first paint.
 * Kept flat internally for simple forms + storage; maps to the standard's
 * grouped brand object (identity / logo / color / type / contact / locale).
 */

export interface BrandLink {
  readonly label: string;
  readonly url: string;
}

export interface BrandConfig {
  productName: string; // identity.productName
  tagline: string; // identity.tagline
  logoLight: string; // logo.logoLight — asset URL ("" = use product name text)
  logoDark: string; // logo.logoDark
  icon: string; // logo.icon (favicon)
  background: string; // color.background (hex) — the base the neutral palette derives from
  primary: string; // color.primary (hex) — brand/accent tokens derived from it
  fontFamily: string; // type.fontFamily — allowlist key
  supportEmail: string; // contact.supportEmail
  supportUrl: string; // contact.supportUrl
  links: BrandLink[]; // contact.links
  locale: string; // locale.locale
  dir: "ltr" | "rtl"; // locale.dir
  onboarded: boolean; // first-run flag
  onboardingStep: number; // resumable progress
}

/** Allowlisted font families (§3 "from an allowlist"). Key → CSS stack. */
export const FONT_ALLOWLIST: Record<string, string> = {
  system: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  inter: "Inter, ui-sans-serif, system-ui, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  serif: "ui-serif, Georgia, Cambria, Times New Roman, serif",
};

export const BRAND_DEFAULTS: BrandConfig = {
  productName: "PortBridge",
  tagline: "self-hosted docker forwards",
  logoLight: "",
  logoDark: "",
  icon: "",
  background: "#ffffff", // white — clean monochrome default; neutrals derive from it
  primary: "#000000", // black — the default accent/fill on white
  fontFamily: "system",
  supportEmail: "",
  supportUrl: "",
  links: [],
  locale: "en",
  dir: "ltr",
  onboarded: false,
  onboardingStep: 0,
};

/** Fields the branding editor / onboarding may write (excludes the flow flags). */
export type BrandInput = Partial<Omit<BrandConfig, "onboarded" | "onboardingStep">>;
