import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import type { BrandInput } from "../../brand/types.ts";
import { BrandStore, BrandValidationError } from "../../brand/store.ts";
import { ONBOARDING_STEPS, onboardingFragment, onboardingPage } from "../views/onboarding.ts";

// Fields captured at each step (must mirror the step forms in the view).
const STEP_KEYS: readonly (readonly string[])[] = [
  ["productName"],
  ["background", "primary", "logoDark", "tagline"],
  ["supportEmail", "supportUrl", "fontFamily", "dir", "locale"],
];

function pick(body: Record<string, unknown>, keys: readonly string[]): BrandInput {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = body[k];
    if (typeof v === "string") out[k] = v;
  }
  return out as unknown as BrandInput;
}

export function onboardingRoutes(store: BrandStore): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/onboarding", (c) => {
    const brand = store.get();
    if (brand.onboarded) return c.redirect("/", 302);
    return c.html(onboardingPage(brand, brand.onboardingStep, c.get("csrf")));
  });

  router.post("/onboarding", async (c) => {
    const body = await c.req.parseBody();
    const step = Math.max(0, Math.min(Number(body["step"]) || 0, ONBOARDING_STEPS - 1));
    const action = String(body["action"] ?? "next");
    if (action !== "skip") {
      try {
        store.save(pick(body, STEP_KEYS[step] ?? []));
      } catch (err) {
        if (err instanceof BrandValidationError) return c.html(onboardingFragment(store.get(), step, err.message));
        throw err;
      }
    }
    const next = step + 1;
    if (next >= ONBOARDING_STEPS) {
      store.setOnboarding({ step: ONBOARDING_STEPS, onboarded: true });
      c.header("HX-Redirect", "/"); // land in the working, branded app
      return c.body(null, 200);
    }
    store.setOnboarding({ step: next });
    return c.html(onboardingFragment(store.get(), next));
  });

  return router;
}
