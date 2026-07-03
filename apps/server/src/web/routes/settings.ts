import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import type { BrandInput } from "../../brand/types.ts";
import { BrandStore, BrandValidationError } from "../../brand/store.ts";
import { settingsForm, settingsPage } from "../views/settings.ts";

const EDITABLE = [
  "productName", "tagline", "logoDark", "icon", "background", "primary",
  "fontFamily", "supportEmail", "supportUrl", "locale", "dir",
] as const;

function pickAll(body: Record<string, unknown>): BrandInput {
  const out: Record<string, string> = {};
  for (const k of EDITABLE) {
    const v = body[k];
    if (typeof v === "string") out[k] = v;
  }
  return out as unknown as BrandInput;
}

export function settingsRoutes(store: BrandStore): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/settings", (c) => {
    const notice = c.req.query("saved") === "1" ? ({ kind: "ok", text: "Branding saved." } as const) : undefined;
    return c.html(settingsPage(store.get(), c.get("csrf"), notice));
  });

  router.post("/settings", async (c) => {
    try {
      store.save(pickAll(await c.req.parseBody()));
      // Full reload so the new tokens apply before first paint.
      c.header("HX-Redirect", "/settings?saved=1");
      return c.body(null, 200);
    } catch (err) {
      if (err instanceof BrandValidationError) {
        return c.html(settingsForm(store.get(), { kind: "error", text: err.message }));
      }
      throw err;
    }
  });

  return router;
}
