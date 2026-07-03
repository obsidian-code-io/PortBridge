import { html } from "hono/html";
import type { Html } from "./html.ts";
import type { BrandConfig } from "../../brand/types.ts";
import { layout } from "./layout.ts";
import { basicsFields, brandingFields, prefFields } from "./brand-form.ts";

interface Step {
  readonly title: string;
  readonly subtitle: string;
  readonly fields: (b: BrandConfig) => Html;
  readonly cta: string;
}

const STEPS: readonly Step[] = [
  { title: "Workspace basics", subtitle: "The minimum to get started — everything else has smart defaults.", fields: basicsFields, cta: "Next" },
  { title: "Branding essentials", subtitle: "Product name, colour and logo. Applied to the app instantly.", fields: brandingFields, cta: "Next" },
  { title: "Preferences", subtitle: "Support links, font and text direction — all optional.", fields: prefFields, cta: "Finish" },
];

export const ONBOARDING_STEPS = STEPS.length;

function progress(step: number): Html {
  return html`<div class="mb-4">
    <div class="mb-1 flex items-center gap-1.5" aria-hidden="true">
      ${STEPS.map((_, i) => html`<span class="h-1.5 flex-1 rounded" style="background:${i <= step ? "var(--brand-primary)" : "var(--brand-border)"}"></span>`)}
    </div>
    <p class="text-xs" style="color:var(--brand-muted)">Step ${step + 1} of ${STEPS.length}</p>
  </div>`;
}

export function onboardingFragment(brand: BrandConfig, step: number, error?: string): Html {
  const idx = Math.max(0, Math.min(step, STEPS.length - 1));
  const s = STEPS[idx]!;
  return html`<div>
    ${progress(idx)}
    <h2 class="text-lg font-semibold">${s.title}</h2>
    <p class="mb-4 text-sm" style="color:var(--brand-muted)">${s.subtitle}</p>
    ${error !== undefined
      ? html`<div class="mb-3 rounded-md border px-3 py-2 text-sm" style="border-color:var(--brand-danger);color:var(--brand-danger)">${error}</div>`
      : ""}
    <form hx-post="/onboarding" hx-target="#onboarding" hx-swap="innerHTML" class="space-y-4">
      <input type="hidden" name="step" value="${idx}" />
      ${s.fields(brand)}
      <div class="flex flex-wrap items-center gap-3 pt-1">
        <button name="action" value="next" type="submit"
          class="rounded-md px-4 py-2 text-sm font-medium hover:opacity-90"
          style="background:var(--brand-primary);color:var(--brand-primary-fg);min-height:44px">${s.cta}</button>
        <button name="action" value="skip" type="submit"
          class="rounded-md px-3 py-2 text-sm hover:opacity-80"
          style="color:var(--brand-muted);min-height:44px">Skip</button>
        <a href="/settings" class="text-sm hover:opacity-80" style="color:var(--brand-accent)">set up later in Settings</a>
      </div>
    </form>
  </div>`;
}

export function onboardingPage(brand: BrandConfig, step: number, csrf: string): Html {
  const body = html`<div class="mx-auto mt-10 max-w-md rounded-lg border p-6" style="border-color:var(--brand-border);background:var(--brand-surface)">
    <h1 class="mb-1 text-xl font-semibold">Welcome to ${brand.productName}</h1>
    <p class="mb-5 text-sm" style="color:var(--brand-muted)">Let's get you to a working, branded app.</p>
    <div id="onboarding">${onboardingFragment(brand, step)}</div>
  </div>`;
  return layout("Get started", body, { brand, csrf, bare: true });
}
