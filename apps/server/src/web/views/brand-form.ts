import { html } from "hono/html";
import type { Html } from "./html.ts";
import { FONT_ALLOWLIST, type BrandConfig } from "../../brand/types.ts";

const INPUT = "w-full rounded-md border px-3 py-2 text-sm";
const INPUT_STYLE = "border-color:var(--brand-border);background:var(--brand-surface);min-height:44px";

interface FieldOpts {
  type?: string;
  hint?: string;
  placeholder?: string;
}

function labeled(label: string, inner: Html, hint?: string): Html {
  return html`<label class="block">
    <span class="mb-1 block text-sm" style="color:var(--brand-muted)">${label}</span>
    ${inner}
    ${hint !== undefined ? html`<span class="mt-1 block text-xs" style="color:var(--brand-muted)">${hint}</span>` : ""}
  </label>`;
}

export function field(name: string, label: string, value: string, opts: FieldOpts = {}): Html {
  return labeled(
    label,
    html`<input name="${name}" type="${opts.type ?? "text"}" value="${value}" placeholder="${opts.placeholder ?? ""}"
      class="${INPUT}" style="${INPUT_STYLE}" />`,
    opts.hint,
  );
}

export function colorField(name: string, label: string, value: string): Html {
  return labeled(
    label,
    html`<span class="flex items-center gap-2">
      <input name="${name}" type="color" value="${value}" aria-label="${label}"
        class="rounded border" style="border-color:var(--brand-border);height:44px;width:56px" />
      <code class="text-xs" style="color:var(--brand-muted)">${value}</code>
    </span>`,
    "Validated for WCAG AA contrast on save.",
  );
}

export function selectField(
  name: string,
  label: string,
  value: string,
  options: ReadonlyArray<{ value: string; label: string }>,
): Html {
  return labeled(
    label,
    html`<select name="${name}" class="${INPUT}" style="${INPUT_STYLE}">
      ${options.map((o) => html`<option value="${o.value}" ${o.value === value ? "selected" : ""}>${o.label}</option>`)}
    </select>`,
  );
}

const FONT_OPTIONS = Object.keys(FONT_ALLOWLIST).map((k) => ({ value: k, label: k }));
const DIR_OPTIONS = [
  { value: "ltr", label: "Left-to-right" },
  { value: "rtl", label: "Right-to-left (Urdu, Arabic)" },
];

export function basicsFields(b: BrandConfig): Html {
  return html`${field("productName", "Workspace / product name", b.productName, {
    hint: "Shown in the header and browser tab.",
  })}`;
}

export function brandingFields(b: BrandConfig): Html {
  return html`<div class="space-y-3">
    ${colorField("primary", "Primary colour", b.primary)}
    ${field("logoDark", "Logo URL", b.logoDark, { type: "url", placeholder: "https://…/logo.svg", hint: "Leave blank to use the product name." })}
    ${field("tagline", "Tagline", b.tagline)}
  </div>`;
}

export function prefFields(b: BrandConfig): Html {
  return html`<div class="space-y-3">
    ${field("supportEmail", "Support email", b.supportEmail, { type: "email" })}
    ${field("supportUrl", "Support URL", b.supportUrl, { type: "url" })}
    ${selectField("fontFamily", "Font", b.fontFamily, FONT_OPTIONS)}
    ${selectField("dir", "Text direction", b.dir, DIR_OPTIONS)}
    ${field("locale", "Locale", b.locale, { placeholder: "en, ur, …" })}
  </div>`;
}

export function allBrandFields(b: BrandConfig): Html {
  return html`<div class="space-y-3">
    ${basicsFields(b)}
    ${brandingFields(b)}
    ${field("icon", "Favicon URL", b.icon, { type: "url", placeholder: "https://…/icon.png" })}
    ${prefFields(b)}
  </div>`;
}
