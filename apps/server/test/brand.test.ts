import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { contrastRatio, ensureReadable, parseHex, readableFg } from "../src/brand/contrast.ts";
import { brandStyleCss, deriveTokens, themeBackgrounds } from "../src/brand/tokens.ts";
import { BrandStore, BrandValidationError, validateBrand } from "../src/brand/store.ts";
import { BRAND_DEFAULTS } from "../src/brand/types.ts";

const DIR = `/tmp/portbridge-brand-test-${process.pid}`;
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe("contrast (WCAG)", () => {
  test("ratio extremes + parsing", () => {
    expect(Math.round(contrastRatio("#ffffff", "#000000"))).toBe(21);
    expect(contrastRatio("#000", "#000000")).toBeCloseTo(1, 5);
    expect(parseHex("#38bdf8")).toEqual({ r: 0x38, g: 0xbd, b: 0xf8 });
    expect(parseHex("nope")).toBeUndefined();
  });

  test("readableFg picks the legible text colour", () => {
    expect(readableFg("#020617")).toBe("#ffffff"); // dark bg → white text
    expect(readableFg("#38bdf8")).toBe("#000000"); // bright fill → black label
  });

  test("ensureReadable moves a dim colour toward the readable end until it meets the ratio", () => {
    // dark bg → steps toward white
    const onDark = ensureReadable("#0b3a55", "#020617", 4.5);
    expect(contrastRatio(onDark, "#020617")).toBeGreaterThanOrEqual(4.5);
    // light bg → steps toward black (a pale colour becomes a legible dark one)
    const onLight = ensureReadable("#9be7ff", "#ffffff", 4.5);
    expect(contrastRatio(onLight, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("validateBrand (validate on save)", () => {
  test("accepts a good primary, rejects unparseable / invisible ones (default white bg)", () => {
    expect(validateBrand({ primary: "#1d4ed8" })).toEqual([]); // dark blue, legible on white
    expect(validateBrand({ primary: "#000000" })).toEqual([]); // black on white
    expect(validateBrand({ primary: "teal" }).length).toBeGreaterThan(0);
    expect(validateBrand({ primary: "#eeeeee" }).length).toBeGreaterThan(0); // ~= white, invisible
    expect(validateBrand({ background: "not-hex" }).length).toBeGreaterThan(0);
    expect(validateBrand({ dir: "sideways" as unknown as "ltr" }).length).toBeGreaterThan(0);
    expect(validateBrand({ fontFamily: "comic" }).length).toBeGreaterThan(0);
  });
  test("the same primary can be valid on one bg and rejected on another", () => {
    expect(validateBrand({ primary: "#38bdf8" }, "#020617")).toEqual([]); // sky on dark: fine
    expect(validateBrand({ primary: "#38bdf8" }, "#ffffff").length).toBeGreaterThan(0); // on white: too dim
  });
});

describe("tokens", () => {
  test("derive a coherent light theme from a white background", () => {
    const t = deriveTokens("#ffffff", "#1d4ed8");
    expect(t["brand-bg"]).toBe("#ffffff");
    expect(readableFg("#ffffff")).toBe("#000000");
    expect(contrastRatio(t["brand-fg"]!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t["brand-muted"]!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t["brand-accent"]!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t["brand-primary-fg"]!, "#1d4ed8")).toBeGreaterThanOrEqual(4.5);
  });
  test("derive a coherent dark theme from a dark background", () => {
    const t = deriveTokens("#020617", "#38bdf8");
    expect(contrastRatio(t["brand-fg"]!, "#020617")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t["brand-muted"]!, "#020617")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t["brand-accent"]!, "#020617")).toBeGreaterThanOrEqual(4.5);
  });
  test("brandStyleCss emits the vars + font", () => {
    const css = brandStyleCss({ ...BRAND_DEFAULTS, background: "#ffffff", primary: "#000000" });
    expect(css).toContain("--brand-bg:#ffffff");
    expect(css).toContain("--brand-primary:#000000");
    expect(css).toContain("--brand-font:");
  });
  test("brandStyleCss ships both a light default and a dark scheme", () => {
    const css = brandStyleCss({ ...BRAND_DEFAULTS, background: "#ffffff", primary: "#000000" });
    expect(css).toContain(":root{--brand-bg:#ffffff"); // light on :root
    expect(css).toContain("prefers-color-scheme:dark"); // follow the system when unset
    expect(css).toContain('[data-theme="dark"]'); // explicit dark override
    const light = themeBackgrounds("#ffffff");
    expect(light.light).toBe("#ffffff");
    expect(light.dark).not.toBe("#ffffff"); // a real dark base is derived
    expect(themeBackgrounds("#0b0b0d").light).toBe("#ffffff"); // a dark brand still gets a light mode
  });
});

describe("BrandStore (persistence + parity)", () => {
  test("defaults, save, validation, parity across instances", () => {
    const store = new BrandStore(DIR);
    expect(store.get().onboarded).toBe(false);
    expect(store.get().productName).toBe("PortBridge");

    store.save({ productName: "Acme Tunnels", primary: "#1d4ed8" });
    expect(store.get().productName).toBe("Acme Tunnels");
    expect(store.get().primary).toBe("#1d4ed8");

    expect(() => store.save({ primary: "#eeeeee" })).toThrow(BrandValidationError); // invisible on white

    store.setOnboarding({ step: 2, onboarded: true });
    expect(store.get().onboardingStep).toBe(2);

    // parity: onboarding + settings share the store; a fresh reader sees it.
    const reader = new BrandStore(DIR);
    expect(reader.get().productName).toBe("Acme Tunnels");
    expect(reader.get().onboarded).toBe(true);
  });
});
