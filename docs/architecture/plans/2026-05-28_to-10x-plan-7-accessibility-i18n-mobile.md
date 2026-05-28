# Plan 7 — Accessibility, i18n, Mobile/Responsive (4 PRs, no schema bump)

> **For Hermes:** Use `subagent-driven-development` skill. This plan brings the UI from "desktop-Chrome-only English" to "WCAG 2.2 AA, 4 languages, mobile-tested across 3 breakpoints". Required for any institutional buyer or regulatory review.

**Goal:** Make the application usable by reviewers with disabilities, in regional Indian languages, and on tablets/phones. None of these are nice-to-haves; they're table stakes for SEBI / SaaS-procurement compliance.

**Architecture:**
- Accessibility: WCAG 2.2 AA via axe-core CI gate + keyboard-nav audit + screen-reader test plan
- i18n: `react-i18next` with English + Hindi + Tamil + Bengali (cover ~70% of Indian financial professionals)
- Responsive: Tailwind breakpoint system formalized; mobile-first refactor of report tabs

**Tech Stack:** `react-i18next` + `i18next-browser-languagedetector`, `@axe-core/react`, `@axe-core/playwright`. No backend changes.

**Sequencing rule:** PR-7.1 (a11y foundation) first because i18n strings need to be a11y-correct from inception. PR-7.2/7.3 parallel after.

---

## PR-7.1 — Accessibility foundation (WCAG 2.2 AA)

**Branch:** `a11y/wcag-2.2-aa-foundation`
**Estimated diff:** +1,500 / -800, 4 new files

**Why:** Today the app has no `<label htmlFor>`, no ARIA roles on the tab-bar, no skip-link, no focus-visible states. A blind reviewer cannot use it. A motor-impaired reviewer using keyboard navigation cannot reach key actions. Both are legal-review blockers.

**Steps:**

1. Add `@axe-core/react` for dev-time violation logging:
   ```ts
   // src/main.tsx
   if (import.meta.env.DEV) {
     import("react").then((R) =>
       import("react-dom").then((RD) =>
         import("@axe-core/react").then((m) => m.default(R, RD, 1000))
       )
     );
   }
   ```
2. Add `@axe-core/playwright` for CI: every E2E test runs `injectAxe()` + `checkA11y()`. Fails build on serious/critical violations.
3. Audit each report tab manually:
   - Add `<label htmlFor>` to every input
   - Add `role="tablist"` / `role="tab"` / `role="tabpanel"` to the tab system; arrow-key navigation
   - Add visible focus-ring (Tailwind `focus-visible:ring-2 focus-visible:ring-emerald-500`)
   - Add `<a href="#main">Skip to content</a>` skip-link
   - Verify color contrast: 4.5:1 for body text, 3:1 for large text
4. Heatmaps and sensitivity grids need text alternatives — add `aria-label` summarizing the grid + `<table role="table">` fallback toggleable via "View as table" button
5. Charts (`recharts`) need text alternatives — add per-chart `<figcaption>` summarizing trend + `aria-describedby`
6. Build a11y test plan in `docs/a11y/test-plan.md`: NVDA + Windows, VoiceOver + macOS, JAWS + Windows. Each report tab tested end-to-end.

**Acceptance test:**

```bash
npm run test:e2e -- --grep "@a11y"           # all green, zero violations
npx @axe-core/cli http://localhost:5173 --exit   # 0 critical
```

**Verification gate (CI):**

`scripts/check-a11y.cjs` reads playwright + axe results JSON. Fails on any `serious` or `critical` violation. `moderate` is reported but not gating.

---

## PR-7.2 — i18n (English + Hindi + Tamil + Bengali)

**Branch:** `i18n/four-languages`
**Estimated diff:** +2,200 / -1,800, 4 new locale files

**Why:** A Mumbai-based audit committee chair likely reads English. A Chennai senior reviewer may prefer Tamil. A Kolkata regulator may prefer Bengali. A Hindi-speaking institutional analyst dominates the market. Four languages cover the realistic addressable user base.

**Steps:**

1. Install `react-i18next` + `i18next` + `i18next-browser-languagedetector`.
2. Create locale tree:
   ```
   src/locales/
     en/
       common.json
       reports.json
       valuation.json
       errors.json
     hi/
       common.json     ← Hindi (Devanagari)
       reports.json
       valuation.json
       errors.json
     ta/  ← Tamil
     bn/  ← Bengali
   ```
3. Extract every user-facing string from components into the locale files. Categorize:
   - `common.*` — buttons, labels, statuses
   - `reports.*` — tab names, table headers, footnotes
   - `valuation.*` — RNOA, FCF, EPS, terminology
   - `errors.*` — validation messages, gate failures
4. **Critical for financial terms:** maintain a glossary `docs/i18n/glossary.md` with the canonical translation for every accounting term (e.g. `RNOA → हिंदी: शुद्ध परिचालन परिसंपत्तियों पर प्रतिफल`). Reviewer-grade translation, not Google Translate.
5. Locale-aware number formatting:
   ```ts
   // src/lib/i18n/formatters.ts
   export function formatINRCrore(value: number, locale: string): string {
     const formatter = new Intl.NumberFormat(locale, {
       style: "currency",
       currency: "INR",
       maximumFractionDigits: 2,
       notation: "compact",
       compactDisplay: "short"
     });
     return formatter.format(value * 1e7);  // crore → absolute for Intl
   }
   ```
6. Add language switcher to AppShell header (top-right, dropdown).
7. Persist user language preference to KV (Plan 4) under `penman:user:<userId>:settings.locale`.
8. Tests: 12 cases — every component renders correctly in each language, formatters produce locale-appropriate output, fallback to English on missing key.

**Acceptance test:**

```bash
# Translation completeness
node scripts/check-i18n-completeness.cjs   # exit 0; every key in en/ has hi/ ta/ bn/ counterparts

# Visual smoke test in each language
npm run test:e2e -- --grep "@i18n"
```

**Verification:**

`scripts/check-i18n-completeness.cjs` parses `src/locales/en/*.json`, walks the key tree, and asserts every key exists in `hi/`, `ta/`, `bn/`. Missing keys → fail build.

---

## PR-7.3 — Mobile/responsive refactor

**Branch:** `responsive/mobile-first-tabs`
**Estimated diff:** +1,200 / -900

**Why:** Reports today are designed for ≥1280px desktop. On a 768px tablet (iPad), tables overflow. On 375px phone (iPhone SE), the tab bar wraps awkwardly and data tables are unreadable. A reviewer on a long flight reading on iPad gets a degraded experience that's not the engine's fault but feels like one.

**Steps:**

1. Formalize Tailwind breakpoint policy in `docs/ui/responsive-policy.md`:
   - `xs` (default, ≤640px): mobile portrait — single column, collapsed tab bar
   - `sm` (≥640px): mobile landscape / small tablet
   - `md` (≥768px): tablet portrait — 2-column layouts allowed
   - `lg` (≥1024px): tablet landscape / small desktop
   - `xl` (≥1280px): desktop full
2. Refactor tab bar:
   - On `xs`: hamburger menu drawer (Tailwind `hidden lg:flex` for tabs, `flex lg:hidden` for hamburger)
   - On `sm`+: horizontal tab bar with overflow scroll
   - On `lg`+: full tab bar
3. Refactor data tables:
   - On `xs`: card-style stacked layout (each row becomes a card with key-value pairs)
   - On `md`+: traditional table
   - Use Tailwind `hidden md:table-row` / `flex md:hidden` toggle
4. Sensitivity grids and heatmaps: on `xs`, replace with vertical list of "WACC=X% → IV=₹Y/share" rows.
5. Charts (recharts): set `width="100%"` height responsive, breakpoint-conditional aspect ratios.
6. Test matrix: Chrome desktop 1920px, iPad 768px portrait, iPhone 12 390px portrait.
7. Tests: visual regression via Playwright `page.screenshot()` at each breakpoint. Lock baseline screenshots; CI fails on > 0.1% pixel diff.

**Acceptance test:**

```bash
npm run test:e2e -- --grep "@responsive"            # green at all 3 breakpoints
npx playwright test --project=Mobile-Chrome         # green on small viewport
```

---

## PR-7.4 — Print / export-friendly stylesheets

**Branch:** `responsive/print-stylesheets`
**Estimated diff:** +400 / -50

**Why:** Reviewers print PDFs. Current report tabs print with the dark mode background, broken page breaks, and missing page numbers. A printed PDF is half the audit evidence trail.

**Steps:**

1. Add `print.css` with:
   - Force light mode background (white)
   - Hide nav, sidebar, language switcher, action buttons
   - `@page { size: A4; margin: 20mm; }` rules
   - `page-break-before: always` on each report-tab section
   - Visible URLs after links: `a[href]::after { content: " (" attr(href) ")"; }`
2. Add "Print preview" mode toggle that switches the screen layout to print-CSS-applied for visual verification before printing.
3. Add page header (company name + run ID) and footer (page number + retrieval date) via `@page` rules.
4. Tests: visual regression on print mode — Playwright with `media: "print"` emulation.

**Acceptance test:**

```bash
npm run test:e2e -- --grep "@print"   # green
# Manual: Cmd+P preview is clean, A4-sized, page numbers visible
```

---

## Cross-cutting acceptance for Plan 7

```bash
# ─── Accessibility ──────────────────────────
npm run test:e2e -- --grep "@a11y"     # 0 critical violations
npx @axe-core/cli https://preview-deploy.vercel.app  # 0 critical

# ─── i18n completeness ─────────────────────
node scripts/check-i18n-completeness.cjs   # exit 0
ls src/locales/                            # en, hi, ta, bn

# ─── Responsive matrix ─────────────────────
npm run test:e2e -- --grep "@responsive"   # green at xs/md/lg/xl

# ─── Print mode ────────────────────────────
npm run test:e2e -- --grep "@print"        # green

# ─── Bundle budget ─────────────────────────
npm run check:bundle   # i18next + locales add ≤ 50KB to entry
```

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Translation accuracy in financial terms | high | Glossary reviewed by a CA/CFA in each language; reviewer credentials cited in `docs/i18n/glossary.md` |
| Locale file drift (English ahead of others) | high | CI gate (`check-i18n-completeness`) blocks merge until all languages have all keys |
| Mobile tables become unusable for dense data | medium | Card layout is opt-in: user can toggle "Compact table view" even on small screens |
| Axe violations on third-party (recharts) | medium | Wrap in custom component with explicit ARIA; document recharts-specific patterns |
| Print CSS breaks on Firefox vs Chrome | low | Test matrix includes both; document supported PDF engines |

## Definition of done

10/10 means:
1. WCAG 2.2 AA conformance verified by axe-core + manual screen-reader test
2. Four languages (English, Hindi, Tamil, Bengali) at 100% key coverage with reviewer-grade translations
3. Mobile-tested at 3 breakpoints; data presents legibly on iPhone
4. Print preview renders A4-clean with page numbers and citations
5. CI gates prevent regression on any of the above
