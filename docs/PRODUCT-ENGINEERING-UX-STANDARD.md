# Product Engineering + UX Standard

The single standard for building, auditing, branding, and onboarding every
product in this studio. Source of truth for Claude Code in this repo. Every
product built against this standard ships white-label ready, with onboarding
and branding configurable on the onboarding screen or the Settings page.

## 1. Operating Principle (read first — sets precedence)

Higher wins.

1. **Real user outcomes and measurable criteria are the verdict.** A screen
   passes only when a real user completes the goal and it meets testable
   thresholds: task success, WCAG AA, latency budget, error rate, onboarding
   completion. Nothing passes because it "looks clean" or "follows a rule."
2. **The UX rules in Appendix A are priors and shared vocabulary, not law.**
   When a rule conflicts with a measured outcome, the measurement wins. When two
   rules conflict, pick the one that improves the measured outcome.
3. **Never** instruct an agent to "satisfy every rule" or "produce the best
   possible version" — both are unsatisfiable and never terminate. Instruct it
   to meet the defined thresholds, then stop.

If any section conflicts with this principle, this principle wins.

## 2. Onboarding Standard

Goal: get the user to first value fast, capture only what the product needs,
let everything else wait.

**Flow**
1. Workspace basics — the minimum to create a tenant.
2. Branding essentials — product name, logo, primary color. On submit the app
   is immediately branded. Everything else defaults (Section 3).
3. Product-critical setup — the one or two things this product needs. No more.
4. Land in a working, branded app — not empty states with no next action.

**Rules**
- Smart defaults on every field; a user can skip the whole flow and still land
  in a working product.
- Progressive disclosure — push everything that can wait to Settings.
- Skippable and resumable — every step has Skip / "set up later in Settings";
  partial progress persists server-side and resumes across sessions/devices.
- No dead ends — every onboarding field is also editable in Settings.
- Parity — onboarding writes to the same config store Settings reads/writes.

**Measures (the verdict, not step count):** onboarding completion rate, time to
first value, per-step drop-off. Do not optimize "number of steps" as a proxy.

## 3. Customization / Branding Standard

**Branding is data, not code.** Nothing brand-specific is hardcoded; any product
can be re-skinned for a new client/tenant by changing config only.

**Brand config object**
```
brand {
  identity:  { productName, tagline }
  logo:      { logoLight, logoDark, icon }   // asset URLs
  color:     { primary }                     // other tokens derived from primary + neutrals
  type:      { fontFamily }                  // from an allowlist, optional
  contact:   { supportEmail, supportUrl, links[] }
  locale:    { locale, dir }                 // dir = ltr | rtl
  domain:    { customDomain }                // optional, multi-tenant only
}
```

- Onboarding captures the minimum to reach a branded first run: `productName`,
  `logo`, `color.primary`. Everything else defaults.
- Settings › Branding is the full editor; persisted immediately.
- Persist in a data store (one record single-tenant, per-tenant multi-tenant).
- **Load + apply branding before first paint** (no flash of default branding) —
  at request time (server-rendered) or app startup (client-rendered).
- Expose branding as **themeable tokens** the whole UI reads from
  (`brand-primary`, `brand-fg`, `brand-bg`, `brand-muted`, …). On web these are
  CSS custom properties.
- **No hardcoded brand values in components.** Every component reads tokens.
- Store assets in file/object storage; persist references (URLs/keys), not
  binaries.
- `dir` drives layout direction — RTL and LTR from the same components. Test both.
- **Validate on save** — reject a `primary` that fails WCAG AA contrast against
  the surfaces it will sit on. A client cannot pick an inaccessible brand color.
- Cache + invalidate on change so updates apply without a rebuild/redeploy.

**Single vs multi-tenant** — build the config layer the same way; only the
tenant key and resolution differ.

## 4. Build + Audit Protocol

Assess the running build, not the mockup and not the rules.

**Severity** — Blocker: user cannot complete the core task, or any a11y/security
failure (ship-stopping). Major: completable but with significant friction/error,
or a WCAG AA miss on a key flow. Minor: friction/inconsistency that doesn't
block. Polish: cosmetic.

**Directive:** Assess the running build of [flow]. For every state (default,
empty, loading, error, edge input) record pass/fail on: task completion, WCAG AA
(contrast, target size, keyboard, screen reader), latency budget (instant
<~100ms, flow <~1s, attention lost past ~10s), and RTL if enabled. Classify each
failure with evidence. Fix all blockers and majors completely. Fix minors unless
you state a tradeoff. Re-test the full flow for regressions. Stop when zero
blockers, zero majors, and every remaining minor/polish item is listed with a
justification for a human to approve.

**Human gate:** a human reviews remaining minor/polish items and approves before
merge. The agent does not approve its own justifications.

## 5. Settings (project conventions)

**Git identity** — all commits authored as `mtalhazulf`
/ `talhazulf4163@gmail.com`, set per repo.

**Branch naming** — `type/short-kebab-summary`; `type` ∈ `feat fix chore
refactor docs test perf style`.

**Commit messages** — `type(optional-scope): short imperative summary`.

**Branding config** — persisted in a data store, exposed as themeable tokens
applied before first paint, assets in file/object storage. Stack-independent.

## Appendix A: UX Rules Reference (priors, subordinate to Section 1)

Nielsen's 10 heuristics; Laws of UX (Fitts, Hick, Miller ≈4 not 7, Jakob,
Doherty → use ~100ms/~1s/~10s not 400ms, Peak-End/Zeigarnik/Serial-Position,
Aesthetic-Usability — measure behavior not stated ratings, Postel, Tesler —
system absorbs complexity); Gestalt (descriptive, not a correctness test); visual
fundamentals (hierarchy, contrast, alignment, whitespace, type ~50–75 char
lines); interaction (immediate feedback, signifiers, progressive disclosure,
forgiveness, smart defaults); IA (clear labels, findability, scannability, plain
language); **accessibility (testable, non-negotiable):** contrast 4.5:1 normal /
3:1 large & UI (7:1 AAA), target size ≥24px AA (44/48 AAA/platform), full
keyboard nav + visible focus, semantic HTML + alt + minimal ARIA, never color
alone, respect reduced-motion; mobile/responsive (thumb-friendly, perceived
speed, empty/loading/error as first-class).

Use this appendix for hypotheses and post-hoc explanation. It is **not** a
pass/fail gate — anchor verdicts on Section 4.
