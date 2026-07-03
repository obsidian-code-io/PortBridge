# Build + Audit — Onboarding & Branding (§4)

Automated audit of the white-label onboarding + branding flow against the
[Product Engineering + UX Standard](./PRODUCT-ENGINEERING-UX-STANDARD.md).
Run headless (Chromium 1194, 1280×900) against the real app on a fresh,
not-onboarded data dir, with the production views compiled through Tailwind.

## What was assessed

Every state the flow can be in:

- Login
- Onboarding — Basics, Branding essentials (valid + rejected colour), Preferences
- Landed dashboard (branded, RTL)
- Settings (parity with onboarding + live re-theme)

For each state the harness measured: WCAG AA text contrast (relative-luminance
ratio of every visible text node against its effective background), interactive
target sizes, keyboard-focus visibility, error messaging, brand-token
application before first paint, and RTL mirroring.

## Default scheme: white & black

The default theme is a clean **white background with black type/accent**. The
whole neutral palette is *derived from the background* (`deriveTokens(background,
primary)`), so the same code renders a coherent light **or** dark theme with no
hardcoded palette — a brand can set any background and the surfaces, borders,
muted/accent/ok/danger text all recompute and are re-validated for AA. On-surface
text tokens are ensured against the most extreme chip (`elevated`), so they clear
AA on every surface, not just the base background.

## Result

**No blockers, no majors remain** — re-verified on the white & black scheme in
both LTR and RTL. Fixed across
`fix(a11y): visible focus, AA target sizes, and RTL bidi isolation` and
`feat(brand): white & black default via background-derived tokens`.

| Check | Outcome |
| --- | --- |
| Text contrast (AA 4.5 / 3.0 large) | Pass in every state |
| Keyboard focus visible (2.4.7) | Pass — always-on `:focus-visible` ring |
| Target size min (2.5.8 AA, ≥24px) | Pass |
| Brand tokens before first paint | Pass — `--brand-primary` correct on first render |
| Product name / logo / tagline | Pass — applied from the store |
| Inaccessible primary rejected on save | Pass — clear contrast error, no advance |
| Onboarding ↔ Settings parity | Pass — same store, edits reflected both ways |
| RTL mirroring + LTR code isolation | Pass — layout mirrors, commands stay LTR |
| `prefers-reduced-motion` | Respected |

### Fixed in this pass

- **Focus (2.4.7, was a blocker):** inputs used `outline-none` with no
  replacement ring. Added a global `:focus-visible` outline in the layout and
  removed `outline-none` from the login, brand-form and dashboard inputs.
- **Target size (2.5.8 AA, was major ×11):** header nav links, the sign-out
  button and the onboarding skip link were ~16px tall. Padded to ≥24px; the
  dashboard search input now has a 44px min target.
- **RTL bidi (was a visible defect):** LTR technical content reordered inside
  RTL text — `portbridge tunnel <target> <port>` rendered as
  `<No active forwards…`. Isolated `code`/`pre`/`.font-mono` and forced LTR
  direction on `code`/`pre`.

## Human gate — polish (not auto-approved)

These meet WCAG 2.5.8 AA (all ≥24px) but sit under the 44px comfortable
touch target. In a dense desktop admin console this is a legitimate
design tradeoff, so they are **left for a human to accept or change** rather
than approved by the agent:

| Element | Size | States |
| --- | --- | --- |
| Header nav links (dashboard/audit/settings) + sign out | 32px tall | dashboard, settings |
| Table-row `forward` buttons | 24px tall | dashboard |
| "Set up later in Settings" link | 36px tall | onboarding |
| Sign-in button | 40px tall | login |
| Brand/logo header link | 28px tall | all |

Recommendation if a touch-first surface is ever targeted: bump nav/link/button
vertical padding to reach 44px. For the current desktop console the 24px AA
floor is met and the density is intentional.

## Reproducing

The harness lives in the session scratchpad (`demo/audit-server.ts`,
`demo/audit.ts`): it boots `createApp` with a mock dockerode on a fresh data
dir, drives Playwright through every state, and writes `findings.json` +
per-state screenshots. Tailwind is compiled from the live views before the run.
