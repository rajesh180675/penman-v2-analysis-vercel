# Plan 6 — Security & Operations (4 PRs, no schema bump)

> **For Hermes:** Use `subagent-driven-development` skill. This plan closes the four security/ops gaps that block production-grade deployment: CSP, parser fuzz, bundle hygiene, and migration runner. None of these are user-visible features; all are non-negotiable for a defensible SaaS audit tool.

**Goal:** Make the running deployment hostile-input safe, lean on first paint, and forward-migration-capable so old envelopes never get silently dropped.

**Architecture:**
1. **CSP at the edge** — `vercel.json` security headers, with explicit allow-list reviewed in code review.
2. **Parser hardening** — input fuzz suite of 50 mangled fixtures + sanitization gates.
3. **Bundle discipline** — lazy-load xlsx/jszip on demand, not at app boot. Manual chunk splits enforced by CI budget.
4. **Schema migration runner** — instead of dropping stale envelopes, upgrade them in place where shape allows.

**Tech Stack:** No new runtime dependencies. `@faker-js/faker` already in dev deps for fuzz fixtures.

**Sequencing rule:** PR-6.1 first (zero-risk; doc + headers). Others independent.

---

## PR-6.1 — CSP, security headers, sanitize HTML exports

**Branch:** `security/csp-and-html-sanitization`
**Estimated diff:** +400 / -50, 2 new files

**Why:** Today there's no `Content-Security-Policy` in `vercel.json`. Annual-report PDFs and Capitaline HTML are hostile inputs — one injected `<script>` in the HTML payload and you've got a stored XSS rendering inside a reviewer's browser when they open the workbook export. `dompurify` is in deps but not consistently applied.

**Steps:**

1. Add CSP to `vercel.json`:
   ```jsonc
   {
     "headers": [
       {
         "source": "/(.*)",
         "headers": [
           {
             "key": "Content-Security-Policy",
             "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://blob.vercel-storage.com https://*.kv.vercel-storage.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self';"
           },
           { "key": "X-Frame-Options", "value": "DENY" },
           { "key": "X-Content-Type-Options", "value": "nosniff" },
           { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
           { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
           { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains; preload" }
         ]
       }
     ]
   }
   ```
2. Audit every HTML-rendering surface (`AcademicReport`, `DebugPanel`, anywhere `dangerouslySetInnerHTML` shows up). Wrap each in a single helper:
   ```ts
   // src/lib/security/sanitize.ts
   import DOMPurify from "dompurify";
   const SANITIZE_CONFIG = {
     ALLOWED_TAGS: ["p", "h1", "h2", "h3", "h4", "ul", "ol", "li", "strong", "em", "br", "table", "thead", "tbody", "tr", "td", "th", "code", "pre"],
     ALLOWED_ATTR: ["class", "colspan", "rowspan"],
     FORBID_ATTR: ["style", "onclick", "onerror", "onload"],
   };
   export function sanitizeHtml(html: string): string {
     return DOMPurify.sanitize(html, SANITIZE_CONFIG);
   }
   ```
3. Add `eslint-plugin-react/no-danger` rule. CI fails on any new `dangerouslySetInnerHTML` not routed through `sanitizeHtml()`.
4. Audit Capitaline HTML extraction path (`capitalineParser.ts`). The HTML there is for parsing, not rendering — confirm it never reaches the DOM. Add an integration test that asserts no `<script>` tag from a malicious fixture survives parsing.
5. Spec: `src/lib/security/__tests__/sanitize.spec.ts` — 12 cases including `<script>alert()</script>`, event-handler attributes, javascript: URLs, SVG-onload payloads, base64-encoded scripts.

**Acceptance test:**

```bash
# Headers in production
curl -I https://penman-v2-analysis-vercel.vercel.app/ | grep -i "content-security-policy"   # present

# No raw dangerouslySetInnerHTML
grep -rn "dangerouslySetInnerHTML" src/components/ | grep -v "sanitizeHtml" | wc -l   # = 0

# Sanitization tests
npx vitest run src/lib/security/__tests__/sanitize.spec.ts   # 12 cases green
```

---

## PR-6.2 — Capitaline parser fuzz suite (50 mangled fixtures)

**Branch:** `security/capitaline-fuzz-suite`
**Estimated diff:** +900 / -50, 1 new spec file, 50 new fixture files

**Why:** Per Plan v4 architecture review, `capitalineParser.ts` is 1,150 lines with 8 `any` annotations. It eats ZIPs of Excel/HTML files, often partially-mangled exports from the Capitaline browser session. A single well-formed-but-adversarial input could crash the worker, deny service, or — worse — succeed with garbage that propagates as audit evidence.

**Strategy:** Fuzz testing isn't pure random; it's "structured mangling" of known-good fixtures. Take 5 known-good ZIPs (Bajaj sidecars per memory) and apply 10 mutation classes each = 50 fixtures.

**Mutation classes:**

```
1. Truncation:           cut at 50%, 75%, 99% of buffer length
2. Bit flip:             random byte XOR at random offset (single bit)
3. Header corruption:    overwrite first 4 bytes of ZIP entry
4. Encoding mismatch:    UTF-16 → UTF-8 forced
5. Sheet name unicode:   inject zero-width chars, RTL marks, emoji
6. Numeric overflow:     replace small numbers with 1e308
7. Numeric NaN/Infinity: inject text "NaN" / "Infinity" in numeric cells
8. Empty data:           zero rows after header
9. Duplicate header rows: header appears 3 times
10. SQL/HTML injection:  cell values like "<script>alert(1)</script>", "'; DROP TABLE--"
```

**Steps:**

1. Set up `src/engine/__tests__/fixtures/fuzz-mangled/` directory.
2. Write `scripts/generate-fuzz-fixtures.cjs` that takes 5 base fixtures and applies the 10 mutation classes deterministically (seeded RNG = `0xCAFE`). Outputs 50 ZIPs.
3. Commit the fixtures (gitignored otherwise; carve-out per memory pattern).
4. Write `src/engine/__tests__/capitalineParserFuzz.spec.ts`:
   ```ts
   describe("Capitaline parser — fuzz suite (50 mangled fixtures)", () => {
     for (const fixture of getMangledFixtures()) {
       it(`survives ${fixture.name}`, async () => {
         try {
           const result = await parseCapitaline(fixture.buffer);
           // Survival: parser returned a structured error, not a crash
           expect(result).toHaveProperty("status");
           if (result.status === "ok") {
             // If parsed, every numeric value must be finite
             for (const period of result.rawData) {
               for (const [, value] of Object.entries(period.raw_metric_values)) {
                 expect(Number.isFinite(value as number) || value === null).toBe(true);
               }
             }
           }
         } catch (err) {
           // Parser threw — that's a fail. Should structured-error, not throw.
           throw new Error(`Parser crashed on ${fixture.name}: ${err}`);
         }
       });
     }
   });
   ```
5. Wire `npm run test:fuzz` script.
6. Add `npm run test:fuzz` to `validate:release` (not regular `validate` — fuzz is slower).

**Acceptance test:**

```bash
node scripts/generate-fuzz-fixtures.cjs   # generates 50 fixtures
ls src/engine/__tests__/fixtures/fuzz-mangled/ | wc -l   # = 50
npm run test:fuzz   # 50 cases all pass (parser survives every mutation)
```

**Important:** "pass" doesn't mean "extracts good data". It means "parser returns a structured error or partial data without crashing". That's the security bar.

---

## PR-6.3 — Bundle split: lazy-load xlsx + jszip on ingestion

**Branch:** `security/bundle-lazy-ingestion`
**Estimated diff:** +200 / -100, edits to vite.config.ts + 3 ingestion files

**Why:** xlsx (~750KB minified) + jszip (~100KB) load at app boot but are only needed during Capitaline ingestion. For a user opening the comparison view, that's ~850KB of unnecessary initial bundle. Lazy-load brings the initial-paint chunk down ~30%.

**Steps:**

1. Audit chunks pre-PR:
   ```bash
   npm run build
   ls -la dist/assets/*.js | sort -k5 -n -r | head -10
   ```
2. In `vite.config.ts`, add explicit lazy-chunk for ingestion:
   ```ts
   export default defineConfig({
     // ...
     build: {
       rollupOptions: {
         output: {
           manualChunks(id) {
             if (id.includes("node_modules/xlsx") || id.includes("node_modules/jszip")) {
               return "vendor-ingestion";
             }
             if (id.includes("node_modules/recharts") || id.includes("node_modules/d3")) {
               return "vendor-charts";
             }
             if (id.includes("node_modules/katex")) {
               return "vendor-math";
             }
             // ... existing chunks
           },
         },
       },
     },
   });
   ```
3. Convert ingestion entry points to dynamic imports:
   ```ts
   // src/engine/capitalineParser.ts
   export async function parseCapitaline(buffer: Buffer | Uint8Array): Promise<RawPeriodData[]> {
     const [{ default: JSZip }, XLSX] = await Promise.all([
       import("jszip"),
       import("xlsx"),
     ]);
     // ...
   }
   ```
4. Add `vendor-ingestion` to a dynamic preload hint that fires when the user opens the ingestion tab.
5. Add a CI bundle budget script `scripts/check-bundle-budget.cjs`:
   ```js
   #!/usr/bin/env node
   const BUDGETS = {
     "index": 500_000,            // 500KB initial entry
     "vendor-react": 250_000,
     "vendor-ingestion": 1_200_000, // 1.2MB allowed for ingestion when loaded
     "vendor-charts": 600_000,
     "vendor-math": 300_000,
   };
   // diff against dist/assets/, exit 1 if any chunk exceeds budget
   ```
6. Add `npm run check:bundle` to `validate`.

**Acceptance test:**

```bash
npm run build
ls -la dist/assets/index-*.js   # ≤ 500KB
ls -la dist/assets/vendor-ingestion-*.js   # exists, lazy-loaded
npm run check:bundle   # exit 0
# Manual: open comparison tab in Lighthouse, confirm vendor-ingestion not loaded
```

---

## PR-6.4 — Schema-aware migration runner (upgrade in place)

**Branch:** `security/schema-migration-runner`
**Schema bump:** none (orthogonal)
**Estimated diff:** +700 / -100, 1 new file

**Why:** Plan v4 ships a sanitizer that *rejects* stale envelopes (v8/v9/v10/v11) with telemetry. Users with old localStorage state lose their data on first read after a deploy. For shape-compatible bumps, we should *upgrade* instead of dropping.

**Strategy:** A registry of `(fromVersion, toVersion) → migrator` functions. On envelope load, if the schemaVersion is older than current, walk the registry chain, apply each migrator, and store the upgraded result.

**Target API:**

```ts
// src/engine/migrations/registry.ts
export type Migrator = (envelope: AnyEnvelope) => AnyEnvelope;

const MIGRATORS: { from: string; to: string; fn: Migrator }[] = [
  { from: "2026-04-traceability-v8",  to: "2026-06-traceability-v9",  fn: addConceptIdentityField },
  { from: "2026-06-traceability-v9",  to: "2026-06-traceability-v10", fn: addEconomicSanityField },
  { from: "2026-06-traceability-v10", to: "2026-06-traceability-v11", fn: addUnusualItemManifestField },
  { from: "2026-06-traceability-v11", to: "2026-06-traceability-v12", fn: addLineageRefField },
];

export function migrateEnvelope(envelope: AnyEnvelope): { migrated: AnyEnvelope; chain: string[] } | { error: string } {
  let current = envelope;
  const chain: string[] = [];
  while (current.schemaVersion !== TRACEABILITY_SCHEMA_VERSION) {
    const next = MIGRATORS.find(m => m.from === current.schemaVersion);
    if (!next) return { error: `No migrator from ${current.schemaVersion}` };
    current = next.fn(current);
    chain.push(`${next.from} → ${next.to}`);
    if (chain.length > 10) return { error: "Migration chain too long; suspected cycle" };
  }
  return { migrated: current, chain };
}
```

**Migrator examples:**

```ts
// Adds conceptIdentity with a "synthetic-clean" status — no false confidence claims
export const addConceptIdentityField: Migrator = (env) => ({
  ...env,
  conceptIdentity: {
    status: "synthetic-clean",  // explicit: reconstructed during migration
    conflictCount: 0,
    unresolvedCriticalCount: 0,
    conflicts: [],
    truncated: false,
  },
  schemaVersion: "2026-06-traceability-v9",
});
```

**Steps:**

1. Create `src/engine/migrations/` directory with `registry.ts` and one migrator per version step.
2. Modify `companyRegistrySnapshot.ts` sanitizer:
   - On schema mismatch, FIRST try `migrateEnvelope`.
   - If migration succeeds, replace stale entry with upgraded one (write-through to KV per Plan 4).
   - If migration fails (corrupt input or unknown source version), THEN drop with telemetry as today.
3. Each migration MUST set a sentinel field (e.g. `synthetic-clean` for conceptIdentity, `synthetic` for economicSanity) so workbooks can flag "this run was migrated, the analytical fields were not run from raw data."
4. Surface migration in DebugPanel: the existing migration telemetry now distinguishes "dropped (no migrator)" vs "upgraded (chain: v8 → v9 → ... → v12)".
5. Tests: 16 cases — every (from, to) pair, full chain v8→v12, broken chain, cycle detection, sentinel field correctness.

**Acceptance test:**

```bash
npx vitest run src/engine/migrations/__tests__/   # 16 cases green

# Manual: load v8 localStorage payload in browser → DebugPanel shows
# "Migrated: 2026-04-traceability-v8 → 2026-06-traceability-v12 (4 steps)"
# instead of "Dropped: stale schema"
```

---

## Cross-cutting acceptance for Plan 6

```bash
# ─── Security headers in production ─────────
curl -I $PROD_URL | grep -E "Content-Security-Policy|X-Frame-Options|Strict-Transport-Security" | wc -l   # = 3

# ─── No raw dangerouslySetInnerHTML ─────────
grep -rn "dangerouslySetInnerHTML" src/components/ | grep -v "sanitizeHtml" | wc -l   # = 0

# ─── Fuzz suite passes ──────────────────────
npm run test:fuzz   # 50 cases green

# ─── Bundle budget enforced ─────────────────
npm run check:bundle   # exit 0, initial entry ≤ 500KB

# ─── Migration runner hits ──────────────────
grep -rn "migrateEnvelope" src/lib/ | wc -l   # ≥ 2

# ─── Suite green ────────────────────────────
npm run validate
```

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| CSP too strict, breaks Vercel preview deploys | high | Start with `Content-Security-Policy-Report-Only` for one week to gather violations; tighten to enforcing only after audit |
| Fuzz suite is slow → CI burden | medium | Move to `validate:release` only, not the per-PR `validate`. Time-budget: ≤ 3 min total |
| Lazy-load adds perceived latency on ingestion click | low | Add a 200ms preload hint when the user hovers the ingestion tab |
| Migration silently corrupts a v8 envelope | high | Sentinel fields ("synthetic") flag migrated runs in workbook + UI. Reviewer can choose to ignore or re-run. Telemetry tracks all migrations |
| CSP breaks third-party fonts/scripts later | medium | Allowlist documented in `docs/security/csp-allowlist.md`; new third-party additions require ADR |

## Definition of done

10/10 means:
1. Every response from the deployment carries CSP, X-Frame-Options, HSTS — verifiable with `curl -I`.
2. Every HTML-rendering surface routes through `sanitizeHtml()`. CI breaks any new `dangerouslySetInnerHTML`.
3. The Capitaline parser survives 50 adversarial fixtures with zero crashes.
4. Initial bundle is ≤ 500KB; xlsx and jszip lazy-load only when ingestion runs.
5. v8-through-v11 envelopes upgrade in place; users never silently lose data on a schema bump.
