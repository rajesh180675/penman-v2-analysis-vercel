# Plan 1 — Type Safety Hardening (Schema v12 → v13)

> **For Hermes:** Use `subagent-driven-development` skill to implement this plan task-by-task. Squash-merge each PR via `gh pr merge --squash --delete-branch` after CI green.

**Goal:** Raise type safety from "casual TypeScript" to "audit-grade TypeScript" so unit/currency/percentage bugs are caught at compile time, not by reviewers reading 64K LOC.

**Architecture:** Split the 1,054-line `types.ts` monolith into 6 domain files; strip 196 `any` to <30 with explicit suppression annotations; flip `tsconfig.json` to maximal strict; introduce branded primitives (`INRCrore`, `AbsoluteShares`, `PercentFraction`, `BasisPoints`) so the type system carries unit semantics through the pipeline.

**Tech Stack:** TypeScript 5.9, Vitest 4. No new runtime dependencies.

**Sequencing rule:** Each PR is independently mergeable. PR-1.1 ships first because every other PR builds on the new type module layout.

---

## PR-1.1 — Split `src/engine/types.ts` into 6 domain modules

**Branch:** `types/split-domain-modules`
**Schema bump:** none (compile-time only)
**Estimated diff:** +1,400 / -1,054, 8 new files

**Why:** A single 1,054-line `types.ts` with 55 `^export`s is the textbook coupling smell. Touching one stage's type recompiles 200+ files. Reviewers can't parse the seams between concerns. Splitting along the rigor pipeline makes the dependency graph honest.

**Target layout:**

```
src/engine/types/
  index.ts                  ← barrel re-export, preserves the existing `from "./types"` callsites
  raw.ts                    ← RawPeriodData, raw_metric_values, ingestion-side primitives
  recast.ts                 ← RecastPeriod, BalanceSheet, IncomeStatement, CashFlow, ChangesInUnitedEquity
  quality.ts                ← Severity, SpecFlag, AnomalyFlag, QualityGateTier, ScopeAssessment
  valuation.ts              ← ValuationResult, ValuationLens, AnchorSelection, KCapitalCost
  unusual.ts                ← UnusualItemBucket, UnusualItemPolicySummary, UnusualItemManifest
  traceability.ts           ← AnalysisTraceabilityEnvelope, AnalysisRigorLevel, ConceptIdentitySummary refs
```

**Steps:**

1. Create `src/engine/types/` directory.
2. Read current `types.ts` end to end. For each `^export`, classify into one of the 6 buckets.
3. Move declarations into the right file. Re-export everything from `index.ts` so external callsites (`import { ... } from "./types"`) stay green.
4. Replace `src/engine/types.ts` with `export * from "./types/index";`.
5. Run `npx tsc --noEmit` after each move; commit on green.
6. After all 6 moves are clean, delete `src/engine/types.ts` and update imports tree-wide via search-and-replace from `from "./types"` → `from "./types/index"` if you want to drop the barrel; otherwise keep the barrel forever (preferred — zero callsite churn).

**Acceptance test:**

```bash
npx tsc --noEmit                                  # zero errors
npm test 2>&1 | tail -5                           # full suite green
grep -rn "from \"\\./types\"" src/ | wc -l        # ≥ 0 (barrel still works)
wc -l src/engine/types/*.ts                       # each file ≤ 350 lines
```

**Rollback:** revert single PR; the barrel file makes this trivial.

---

## PR-1.2 — Strip `any` from engine surface area (196 → <30)

**Branch:** `types/strip-any-from-engine`
**Schema bump:** none
**Estimated diff:** ~+800 / -400 spread across ~40 engine files

**Why:** 196 `any` annotations cluster in `capitalineParser.ts` (8), `analysisTraceability.ts` (8), `anomalyDetection.ts` (17), `bankAssetQuality.ts` (14), `bankValuation.ts` (12), `forecastingEngine.ts` (12). These are exactly the audit-critical paths. `any` neutralizes every other type guarantee in the pipeline.

**Strategy — three-bucket triage:**

```
Bucket A — replace with real type        → ~120 occurrences  (unblocked by PR-1.1's split)
Bucket B — replace with `unknown` + narrow → ~50 occurrences (parser inputs, third-party returns)
Bucket C — keep, annotate `// @ts-expect-error: <reason>` → ~26 (jszip 3.10 typings, xlsx default-import legacy)
```

**Bucket A — common patterns:**

```ts
// before
function detectCapitalEvents(periods: any[]): any[] { ... }

// after
import type { RecastPeriod } from "../types/recast";
import type { CorporateActionEvent } from "./corporateActions";
function detectCapitalEvents(periods: RecastPeriod[]): CorporateActionEvent[] { ... }
```

**Bucket B — narrow at boundary:**

```ts
// before
async function parseSheet(buf: any) {
  const data = buf.data;
  return data.cells;
}

// after
import type { Buffer } from "node:buffer";
async function parseSheet(buf: Buffer | Uint8Array): Promise<Cell[]> {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Cell>(sheet, { defval: null });
}
```

**Bucket C — explicit suppressions only with justification:**

```ts
// @ts-expect-error: jszip 3.10 ships untyped Folder.async; remove when @types/jszip catches up
const text = await file.async("string");
```

**Steps:**

1. Run `grep -rn "\\bany\\b" src/engine/ | grep -v "^//\\|test\\|spec" | wc -l` → 196.
2. Per-file passes (smallest first): start with files that have ≤3 `any`, work up to `anomalyDetection.ts` (17) last. Each file is its own commit.
3. After each file, run `npx tsc --noEmit` and `npm test`. Never commit on broken tests.
4. Whitelist file: write `src/engine/__lint__/any-budget.json` with `{ "<file>": <max-allowed-any-count> }`. CI script enforces budget.

**CI guard (new):**

`scripts/check-any-budget.cjs`:

```js
#!/usr/bin/env node
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const budget = JSON.parse(fs.readFileSync("src/engine/__lint__/any-budget.json", "utf8"));
const out = execSync("grep -rln '\\bany\\b' src/engine/ || true").toString();
let failed = false;
for (const [path, allowed] of Object.entries(budget)) {
  const cmd = `grep -c "\\bany\\b" ${path} || true`;
  const got = parseInt(execSync(cmd).toString().trim(), 10) || 0;
  if (got > allowed) {
    console.error(`${path}: ${got} > budget ${allowed}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
```

Wire into `package.json`:

```json
"scripts": {
  "lint:any": "node scripts/check-any-budget.cjs",
  "validate": "npm run typecheck && npm run lint:any && npm run test && npm run build"
}
```

**Acceptance test:**

```bash
grep -rn "\\bany\\b" src/engine/ | grep -v "^//\\|test\\|spec" | wc -l   # ≤ 30
npm run lint:any                                                          # exit 0
npm test 2>&1 | tail -5                                                   # 1120+ passed
```

---

## PR-1.3 — Maximal strict `tsconfig.json`

**Branch:** `types/strict-tsconfig`
**Schema bump:** none
**Estimated diff:** small in tsconfig, ~+200 / -150 across engine to fix new errors

**Why:** Today's `tsconfig.json` is "default-strict". Three flags catch entire classes of bugs we currently rely on review to spot.

**Target diff in `tsconfig.json`:**

```jsonc
{
  "compilerOptions": {
    "strict": true,                            // already true
    "noUncheckedIndexedAccess": true,          // ← NEW: arr[i] is T | undefined
    "exactOptionalPropertyTypes": true,        // ← NEW: { x?: number } means x is missing OR number, not undefined
    "noImplicitOverride": true,                // ← NEW: must say `override` on inherited methods
    "noFallthroughCasesInSwitch": true,        // ← NEW: catches missing `break`
    "useUnknownInCatchVariables": true         // ← NEW: catch (e: unknown), forces narrowing
  }
}
```

**Steps:**

1. Flip flags one at a time. Each flag flip is its own commit.
2. After each flip, run `npx tsc --noEmit | wc -l` → expect a burst of errors (50–200 per flag).
3. Fix the burst before moving to the next flag. Don't suppress; fix.

**Common `noUncheckedIndexedAccess` fixes:**

```ts
// before
const period = periods[0];
const value = period.bs.totalAssets;             // crashes if periods is empty

// after
const period = periods[0];
if (!period) return null;                         // narrow first
const value = period.bs.totalAssets;
```

**Common `exactOptionalPropertyTypes` fixes:**

```ts
// before
type Config = { rate?: number };
const c: Config = { rate: undefined };            // was allowed; now error

// after — pick one:
const c1: Config = {};                            // omit
type ConfigB = { rate?: number | undefined };     // explicit
const c2: ConfigB = { rate: undefined };          // ok
```

**Acceptance test:**

```bash
npx tsc --noEmit          # exit 0
npm test 2>&1 | tail -5   # full suite green
```

---

## PR-1.4 — Branded monetary primitives (Schema v12 → v13)

**Branch:** `types/branded-primitives-v13`
**Schema bump:** `2026-06-traceability-v12` → `2026-06-traceability-v13`
**Estimated diff:** +600 / -300, 3 new files, ~40 modified

**Why:** The user's own memory captures the bug class: *"config.shares_outstanding is CRORE-SHARES (not absolute)"*. Today, every monetary number is `number`. The compiler can't stop you from passing absolute shares to a per-crore EPS calculator. Brand them.

**New file `src/engine/types/units.ts`:**

```ts
/**
 * Branded primitives for unit-semantic-aware numbers.
 *
 * The `__brand` field is a phantom — it never exists at runtime, but
 * TypeScript treats `INRCrore` and `INRAbsolute` as incompatible types
 * even though both are `number` underneath. This catches the unit
 * contract bugs the parser and valuation modules have repeatedly hit.
 *
 * Convention:
 *   - All Capitaline / Indian-context monetary values are INRCrore.
 *   - All shares_outstanding values from the registry are CroreShares.
 *   - All ratios in [0, 1] are PercentFraction (NOT 0–100).
 *   - All BPS spreads are BasisPoints (1 bps = 0.0001 = 0.01% fraction).
 *
 * Constructors validate; accessors are zero-cost.
 */

declare const INR_CRORE_BRAND: unique symbol;
declare const INR_ABSOLUTE_BRAND: unique symbol;
declare const CRORE_SHARES_BRAND: unique symbol;
declare const ABSOLUTE_SHARES_BRAND: unique symbol;
declare const PERCENT_FRACTION_BRAND: unique symbol;
declare const BASIS_POINTS_BRAND: unique symbol;

export type INRCrore        = number & { readonly [INR_CRORE_BRAND]: never };
export type INRAbsolute     = number & { readonly [INR_ABSOLUTE_BRAND]: never };
export type CroreShares     = number & { readonly [CRORE_SHARES_BRAND]: never };
export type AbsoluteShares  = number & { readonly [ABSOLUTE_SHARES_BRAND]: never };
export type PercentFraction = number & { readonly [PERCENT_FRACTION_BRAND]: never };
export type BasisPoints     = number & { readonly [BASIS_POINTS_BRAND]: never };

export const INRCrore = (n: number): INRCrore => {
  if (!Number.isFinite(n)) throw new TypeError(`INRCrore: ${n} is not finite`);
  return n as INRCrore;
};
export const INRAbsolute = (n: number): INRAbsolute => {
  if (!Number.isFinite(n)) throw new TypeError(`INRAbsolute: ${n} is not finite`);
  return n as INRAbsolute;
};
export const CroreShares = (n: number): CroreShares => {
  if (n < 0 || !Number.isFinite(n)) throw new TypeError(`CroreShares: ${n} invalid`);
  return n as CroreShares;
};
export const AbsoluteShares = (n: number): AbsoluteShares => {
  if (n < 0 || !Number.isFinite(n) || !Number.isInteger(n)) throw new TypeError(`AbsoluteShares: ${n} must be a non-negative integer`);
  return n as AbsoluteShares;
};
export const PercentFraction = (n: number): PercentFraction => {
  if (!Number.isFinite(n)) throw new TypeError(`PercentFraction: ${n} not finite`);
  if (n < -2 || n > 5) throw new RangeError(`PercentFraction: ${n} out of plausible range [-2, 5]`);
  return n as PercentFraction;
};
export const BasisPoints = (n: number): BasisPoints => {
  if (!Number.isFinite(n)) throw new TypeError(`BasisPoints: ${n} not finite`);
  return n as BasisPoints;
};

// Conversions — explicit, never automatic
export const croreToAbsolute = (c: INRCrore): INRAbsolute => INRAbsolute(c * 1e7);
export const absoluteToCrore = (a: INRAbsolute): INRCrore => INRCrore(a / 1e7);
export const croreSharesToAbsolute = (c: CroreShares): AbsoluteShares => AbsoluteShares(Math.round(c * 1e7));
export const fractionToBps = (f: PercentFraction): BasisPoints => BasisPoints(f * 10000);
export const bpsToFraction = (b: BasisPoints): PercentFraction => PercentFraction(b / 10000);

// Arithmetic helpers (preserve brand)
export const addCrore = (a: INRCrore, b: INRCrore): INRCrore => INRCrore(a + b);
export const subCrore = (a: INRCrore, b: INRCrore): INRCrore => INRCrore(a - b);
export const mulCroreScalar = (a: INRCrore, s: number): INRCrore => INRCrore(a * s);
export const divCrore = (a: INRCrore, b: INRCrore): PercentFraction => PercentFraction(a / b);
```

**Steps:**

1. Create `src/engine/types/units.ts`.
2. Write `src/engine/types/__tests__/units.spec.ts` with 12 cases: each constructor, each conversion, NaN rejection, range rejection, brand-preservation under arithmetic.
3. Refactor `RawPeriodData.raw_metric_values` so values are `INRCrore` not bare `number`. Cascade through `RecastPeriod.bs/is/cf` numeric fields.
4. Refactor `config.shares_outstanding` to `CroreShares`. Find every callsite (`grep -rn "shares_outstanding"`) and either accept `CroreShares` or convert with `croreSharesToAbsolute()` at the boundary.
5. Refactor ratio fields (`RNOA`, `RoCE`, `NIM`, etc.) to `PercentFraction`. Anywhere they were stored as 0-100 percentages, divide by 100 at the boundary.
6. Bump `TRACEABILITY_SCHEMA_VERSION` to `"2026-06-traceability-v13"` in `policyVersions.ts`.
7. Update `companyRegistryStore.spec.ts` and `ForecastReport.spec.tsx` schemaVersion fixtures to v13. Rename stale-v12 test.
8. Add ADR-005 in `docs/adr/005-branded-primitives.md`.

**Acceptance test:**

```bash
npm test                          # 1120 + new units tests = 1132+ passing
npx tsc --noEmit                  # 0 errors
grep -rn "shares_outstanding" src/ | wc -l   # locate all callsites
grep -rn "as INRCrore" src/        # explicit casts only at parser boundary
```

**Verification — synthetic regression test:**

`src/engine/types/__tests__/unit-contract.spec.ts`:

```ts
import { INRCrore, INRAbsolute, CroreShares, AbsoluteShares, croreToAbsolute } from "../units";
import { computeIntrinsicValuePerShare } from "../../valuation";

describe("unit contract — Plan 1 PR-1.4 regression guard", () => {
  it("refuses to compute IVPS when shares are passed in absolute form", () => {
    const equity = INRCrore(1000);
    // @ts-expect-error: AbsoluteShares is not assignable to CroreShares
    expect(() => computeIntrinsicValuePerShare(equity, AbsoluteShares(100_000_000))).toThrowOrFailToCompile();
  });
});
```

**Rollback:** schema bump means the sanitizer rejects v13 envelopes if reverted to v12 sanitizer. Reverting PR-1.4 forces users to re-run the pipeline (residuals retained, comparisons require fresh runs). Document in `docs/operational-handoff.md`.

---

## Cross-cutting acceptance for Plan 1 overall

After all 4 PRs merge:

```bash
# ─── Type quality budget ─────────────────────
grep -rn "\\bany\\b" src/engine/ | grep -v "^//\\|test\\|spec" | wc -l   # ≤ 30
grep -rn "as any" src/ | wc -l                                            # ≤ 5
wc -l src/engine/types/*.ts | tail -1                                     # total ≈ 1,400, no file > 350

# ─── Strict mode ─────────────────────────────
grep '"strict": true' tsconfig.json                                       # present
grep '"noUncheckedIndexedAccess": true' tsconfig.json                     # present
grep '"exactOptionalPropertyTypes": true' tsconfig.json                   # present

# ─── Branded primitives ─────────────────────
grep -rn "INRCrore\\|CroreShares\\|PercentFraction\\|BasisPoints" src/engine/ | wc -l   # ≥ 200 references

# ─── Schema bump landed ─────────────────────
grep TRACEABILITY_SCHEMA_VERSION src/engine/policyVersions.ts             # = "2026-06-traceability-v13"

# ─── Suite green ────────────────────────────
npm run validate
```

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Strict mode produces 500+ errors that take >1 day to fix | medium | Flip flags one-by-one across separate commits; revert if a single flag generates >100 errors and re-plan that flag in a sub-PR |
| Branded primitives ripple through 200+ callsites | high | Apply per-callsite, per-commit. Boundary helpers (`croreToAbsolute`) keep the surface area at the parser/valuation interface, not internal arithmetic |
| `noUncheckedIndexedAccess` breaks innocuous-looking code | high | Each `arr[i]` becomes `arr[i] | undefined`. Mechanical fix: `if (!x) continue/return;` narrowing. Plan budget: 4 hours per file for the largest engine modules |
| jszip / xlsx don't have proper types | low (already known) | Bucket-C suppression with `// @ts-expect-error: <jszip 3.10 typing gap>` explicit comment |

## Definition of done

10/10 means a reviewer reading any engine module sees:
1. Every numeric primitive carries unit semantics in its type.
2. The 30 remaining `any`s each have a justification comment.
3. `tsc --noEmit` passes with 5 strict flags engaged.
4. New code physically cannot ship a unit-contract bug to production — the compiler stops it.
