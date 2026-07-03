import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { contrastRatio, ensureAccessible, parseHex, readableFg } from "../src/brand/contrast.ts";
import { brandStyleCss, deriveTokens } from "../src/brand/tokens.ts";
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

  test("ensureAccessible lightens a dim colour until it meets the ratio", () => {
    const dim = "#0b3a55"; // low contrast on dark bg
    const bg = "#020617";
    expect(contrastRatio(dim, bg)).toBeLessThan(4.5);
    const fixed = ensureAccessible(dim, bg, 4.5);
    expect(contrastRatio(fixed, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("validateBrand (validate on save)", () => {
  test("accepts a good primary, rejects unparseable / invisible ones", () => {
    expect(validateBrand({ primary: "#38bdf8" })).toEqual([]);
    expect(validateBrand({ primary: "teal" }).length).toBeGreaterThan(0);
    expect(validateBrand({ primary: "#020617" }).length).toBeGreaterThan(0); // == bg, invisible
    expect(validateBrand({ dir: "sideways" as unknown as "ltr" }).length).toBeGreaterThan(0);
    expect(validateBrand({ fontFamily: "comic" }).length).toBeGreaterThan(0);
  });
});

describe("tokens", () => {
  test("derive from primary + accessible accent", () => {
    const t = deriveTokens("#0b3a55");
    expect(t["brand-primary"]).toBe("#0b3a55");
    expect(contrastRatio(t["brand-accent"]!, "#020617")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t["brand-primary-fg"]!, "#0b3a55")).toBeGreaterThanOrEqual(4.5);
  });
  test("brandStyleCss emits the vars + font", () => {
    const css = brandStyleCss({ ...BRAND_DEFAULTS, primary: "#38bdf8" });
    expect(css).toContain("--brand-primary:#38bdf8");
    expect(css).toContain("--brand-font:");
  });
});

describe("BrandStore (persistence + parity)", () => {
  test("defaults, save, validation, parity across instances", () => {
    const store = new BrandStore(DIR);
    expect(store.get().onboarded).toBe(false);
    expect(store.get().productName).toBe("PortBridge");

    store.save({ productName: "Acme Tunnels", primary: "#22c55e" });
    expect(store.get().productName).toBe("Acme Tunnels");
    expect(store.get().primary).toBe("#22c55e");

    expect(() => store.save({ primary: "#010203" })).toThrow(BrandValidationError);

    store.setOnboarding({ step: 2, onboarded: true });
    expect(store.get().onboardingStep).toBe(2);

    // parity: onboarding + settings share the store; a fresh reader sees it.
    const reader = new BrandStore(DIR);
    expect(reader.get().productName).toBe("Acme Tunnels");
    expect(reader.get().onboarded).toBe(true);
  });
});
