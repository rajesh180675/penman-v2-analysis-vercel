# Plan: Delete the dead pipeline-strategy spine, re-home the audit stamp onto the real fork

Status: PLAN ONLY (read mode). No code edited. Deliverable is this document.
Date: 2026-05-30
Decision adopted: Option B (delete the spine) + keep `pipelineStrategyId`, re-homed onto the existing fork.

---

## Goal

Remove the dead pipeline-strategy scaffolding (registry + 4 strategy classes + interface + 3 spec files) that abstracts a single readable `if`, while **preserving and correcting** the `pipelineStrategyId` audit stamp by deriving it from the dispatch fork that actually runs. Do not touch the golden-critical valuation paths (`processBankData`, `computeValuation`). The typed sector-bands contract (the real leakage fix) is scoped as a separate follow-up, not part of this change.

## Current context / assumptions (all verified on disk this session)

1. **The dispatch is a clean two-way fork**, not a pluggable architecture:
   - `src/engine/pipeline.ts:156` — `if (family === "financial-institution" && !scope.blocked)` → `processBankData(...)` (bank/NBFC/insurance; `bankResult.subtype` auto-refines).
   - `src/engine/pipeline.ts:200` — financial **and** blocked → fail-closed empty result.
   - `src/engine/pipeline.ts:217-321` — else (industrial) → recast loop → `computeValuation()` in PenmanNissimEngine; `itServicesDetector`/`cyclicalityDetector` refine the industrial subtype.

2. **The spine is dead in production.** `value()` and the `runXPipeline` helpers have **zero** production call sites (grep: only the throw statements themselves). `matches()`/`recast()`/`computeRatios()`/`detectAnomalies()`/`contributeToEnvelope()` are exercised only by the 3 spec files.

3. **The stamp's ONLY live use of the spine is `selectStrategy()`** at `src/engine/analysisTraceability.ts:466`, imported at lines 21-22. This is the one production seam to re-home.

4. **The current stamp is buggy** (latent): `selectStrategy()` keys off `config.company_type`, but the real fork (pipeline.ts:156) keys off **detected `family`**. For a company left at `company_type: "auto"` that is auto-detected as a bank:
   - `processBankData` runs (correct path), but
   - `selectStrategy(rawData, {company_type:"auto"})` returns `industrial-v1` (auto falls through to the industrial catch-all — confirmed by `pipeline/__tests__/bank.spec.ts` line 27-30).
   - => the audit field says `industrial-v1` for a run that executed the bank pipeline. **Re-homing onto `family`/`subtype` fixes this.**

5. **The stamp field stays; schema is unaffected.** `pipelineStrategyId` is a free-form string consumed by `lib/observability.ts:30`, `lib/auditRunStore.ts:36`, and noted in `lib/envelopeMigrations.ts:93` ("v14 added pipelineStrategyId"). We keep the field, so **no schema bump and no new migration** are required. Old persisted records keep their historical (possibly `industrial-v1`) values — migrations do not rewrite them.

6. **Pipeline strategy tests pass today** (12/12): `bank.spec.ts`, `industrial.spec.ts`, `nbfc-insurance.spec.ts`. They test only the spine and are deleted with it.

7. **There is an ADR** documenting the PR-3.1→3.5 strategy spine (location to confirm under `docs/` — see Step 0). It will document a non-existent architecture after this change and must be superseded.

### Step 0 results — VERIFIED this session (no longer assumptions)
- **Blast radius confirmed clean.** The ONLY production importer of `pipeline/registry|strategy|strategies` is `src/engine/analysisTraceability.ts:21`. The only other importers are the three spec files being deleted. No hidden consumer. ✓
- **ADR + doc references located:**
  - `docs/adr/006-pipeline-strategy-pattern.md` — the ADR to mark Superseded.
  - `docs/architecture/plans/2026-05-28_to-10x-plan-3-pipeline-strategy.md` — roadmap (lines 130/144/187/215 reference the ids/assertions).
  - `docs/architecture/plans/2026-05-28_to-10x-master-index.md` — **contains the `ls src/engine/pipeline/strategies/` acceptance gate** (see Risk below).
  - `docs/SWEEP_CLOSURE.md`, `docs/analysis-rigor-ladder.md` — mention the spine; update references.
- **Golden suite does NOT currently assert `pipelineStrategyId`.** The strings `bank-v1`/`nbfc-v1`/`insurance-v1`/`industrial-v1` appear ONLY in (a) the roadmap doc and (b) the files being deleted. They were **never wired into `goldenCompanyExpectations.spec.ts`**. Two consequences:
  1. The stamp value change (auto-financials `industrial-v1`→`bank-v1`) breaks **no** golden assertion. ✓
  2. The roadmap's intended golden assertions (HDFC=`bank-v1`, Bajaj=`nbfc-v1`, industrial=`industrial-v1`, plan lines 144/187/215) were never built. This PR can fulfill that intent correctly (see revised Step 4).

### One-way-door pre-deletion checks — VERIFIED this session
Deletion is irreversible, so both of these were confirmed on disk before sign-off:

1. **The auto-detect mis-stamp is the GENERAL case (all 3 financial subtypes), not bank-only.** All three financial `matches()` key off an explicit string and the catch-all returns true:
   - `bank.ts` → `config.company_type === "bank"`
   - `nbfc.ts` → `config.company_type === "nbfc"`
   - `insurance.ts` → `config.company_type === "insurance"`
   - `industrial.ts` → `return true`
   `selectStrategy` returns the first match, so ANY company at `company_type: "auto"` that is signal-detected as financial (bank, NBFC, or insurer) falls through to `industrial-v1` while the real fork routes it through `processBankData`. The current stamp is systemically wrong for every auto-detected financial. ✓

2. **`generic-financial → nbfc` is covered, and `detectSubtype` is the canonical source.** `detectSubtype(scope, configHint)` (`src/engine/bankPipeline/ratios.ts:151-177`) precedence: explicit `bank`/`nbfc`/`insurance` configHint wins, else signal counts: insurance≥1→insurance, banking≥2→bank, nbfc≥1→nbfc, banking==1→bank, **else `generic-financial`** (line 176). The plan's `generic-financial → nbfc-v1` mapping mirrors the existing `effectiveCompanyType` mapping at `pipeline.ts:174-175`. ✓

### REFINEMENT to Step 1 (stamp source) — supersedes "use bankResult.subtype"
Source the subtype from **`detectSubtype(scope, config.company_type)` called directly**, NOT from `bankResult.subtype`. Reason: the financial-**blocked** branch (`pipeline.ts:200-215`) returns WITHOUT calling `processBankData`, so `bankResult` (and thus `bankResult.subtype`) does not exist there. `detectSubtype` is a pure `(scope, configHint) → FinancialInstitutionSubtype` function callable on both branches, and on the not-blocked branch it returns exactly the value `bankResult.subtype` already holds (set at `bankPipeline.ts:77`). Using it directly stamps both financial branches uniformly from one source. `detectSubtype` is already exported (`bankPipeline.ts:280`).

Revised `resolvePipelineStrategyId(family, scope, config)`:
- `family === "industrial"` → `"industrial-v1"`
- else (financial, blocked or not): `switch (detectSubtype(scope, config.company_type ?? undefined))` → `bank`→`bank-v1`, `nbfc`→`nbfc-v1`, `insurance`→`insurance-v1`, `generic-financial`→`nbfc-v1`.
### Resolved this session (these were the last open Step 0 items)
- **Builder fn + callers identified.** The builder is `buildAnalysisTraceability(params)` at `analysisTraceability.ts:132`. Production callers: `lib/auditSnapshot.ts:37` (`buildAnalysisSnapshot`) and `lib/publication/analysisPublicationSnapshot.ts:2`. Plus ~10 component/engine **test** call sites that construct params directly. **Critical implication:** `buildAnalysisSnapshot` does NOT receive a `PipelineResult` — it gets `rawData`/`recastData`/`config` separately. Threading a new `pipelineStrategyId` param from `pipeline.ts` would therefore force a new required field through every one of those ~10+ test callers. See the design simplification below, which avoids that entirely.
- **HDFC/Bajaj golden fixtures are EXPLICIT, not auto.** `hdfcBank.spec.ts:27` uses `company_type: "bank"`; golden `cases.ts` ITC/Asian Paints use `company_type: "industrial"`; Bajaj spec uses explicit nbfc. So for the named golden companies the re-home is **preservation** (explicit config already stamps correctly today). The **correctness fix** applies to the broader auto-detected-financial population, which is the real-world default and the systemic bug from check 1 above.

### DESIGN SIMPLIFICATION (supersedes Step 1 + Step 2 plumbing) — builder consumes signals already in-hand
Two facts close this with zero new params and zero recompute:
1. **`bankSubtype` is already a param AND already populated.** `buildAnalysisTraceability` accepts `bankSubtype?: FinancialInstitutionSubtype` (`analysisTraceability.ts:165`), and the live app passes the real detected value: `useAuditAnalysis.ts:182` → `bankSubtype: bankResult?.subtype ?? null` (and `audit-all-companies-setup.ts:252` in the test harness). It's already consumed for reconciliation routing (`:219-223`). **This is the actual root cause:** the live path always had the correct subtype; the stamp code ignored it and called `selectStrategy(config.company_type)` instead.
2. **The full `ScopeAssessment` is already in-hand.** `QualityGateReport.scopeAssessment` is the complete `ScopeAssessment` (`mappingAudit.ts:55`), already read by the builder at `:197/:202/:490-491`. So `analysisFamilyFromScope(scope)` and `detectSubtype(scope, hint)` need no `assessAnalysisScope` recompute.

**Final resolver (replaces the `selectStrategy` block at 463-472), best-effort, tiered:**
```
function resolvePipelineStrategyId(params): string | undefined {
  const toId = (s: FinancialInstitutionSubtype) =>
    s === "bank" ? "bank-v1" : s === "insurance" ? "insurance-v1" : "nbfc-v1"; // nbfc + generic-financial → nbfc-v1
  // 1. Prefer the explicitly-detected subtype the live app already passes.
  if (params.bankSubtype) return toId(params.bankSubtype);
  // 2. Else derive from the scope already carried on qualityGate.
  const scope = params.qualityGate?.scopeAssessment;
  if (scope) {
    return analysisFamilyFromScope(scope) === "financial-institution"
      ? toId(detectSubtype(scope, params.config?.company_type ?? undefined))
      : "industrial-v1";
  }
  // 3. No signal available — leave unset (matches current best-effort semantics).
  return undefined;
}
```
- Tier 1 handles the live not-blocked financial path directly from the param. Tier 2 handles the financial-**blocked** branch (no bankResult, so `bankSubtype` null) and the `auditSnapshot.ts` path (which doesn't pass `bankSubtype`) via scope. Tier 3 preserves "leave unset" when neither exists.
- Imports: REMOVE `selectStrategy` + `./pipeline/strategies` (lines 21-22). ADD `analysisFamilyFromScope` (scopePolicy — `detectSubtype` may already be importable via bankPipeline; confirm at edit time). `FinancialInstitutionSubtype` type is already in scope (used at line 165).

**Net effect on the step plan:**
- Step 1 (touch pipeline.ts) — **DROPPED**. pipeline.ts untouched; no `PipelineResult` shape change.
- Step 2 — single in-builder edit above. No call-site threading; the ~10+ test callers of `buildAnalysisTraceability` are untouched (those that already pass `bankSubtype` get the better Tier-1 result for free).
- **No `assessAnalysisScope` recompute** — the tradeoff noted in the prior iteration is eliminated; scope is reused from `qualityGate`.
- Steps 3 (delete spine), 4 (stamp test), 5 (supersede ADR) unchanged.

## Proposed approach

Single small PR. Compute the stamp where the fork already knows the answer (`pipeline.ts`), thread it into the envelope builder as data, and delete the scaffolding. No valuation code moves. Net result: fewer files, a correct audit stamp, and an honest codebase (no fake pluggable architecture).

### Stamp id vocabulary (preserve existing strings, key off the real path)
Keep the exact id strings the field already uses so the audit vocabulary is stable:
- financial-institution, subtype `bank` → `bank-v1`
- subtype `nbfc` → `nbfc-v1`
- subtype `insurance` → `insurance-v1`
- subtype `generic-financial` → `nbfc-v1` (mirrors the existing `effectiveCompanyType` mapping at pipeline.ts:174-175)
- financial-institution **blocked** → still stamp the subtype-derived id (the financial path was taken); document this choice.
- industrial → `industrial-v1` (do NOT invent `it-services-v1`/`cyclical-v1` — those are subtype refinements for sanity bands, not separate pipelines; see Open Questions).

## Step-by-step plan

**Step 0 — Verify blast radius (read-only, blocks coding):**
```
# Confirm analysisTraceability.ts is the sole production importer:
search: from .*pipeline/(registry|strategy|strategies)   (exclude __tests__)
# Locate the ADR:
search: pipelineStrategyId | "strategy spine" | PR-3.5   in docs/
```
If any production importer besides `analysisTraceability.ts` appears, STOP and re-scope.

**Step 1 — Compute the stamp at the fork (`src/engine/pipeline.ts`):**
- Add a tiny pure helper, e.g. `resolvePipelineStrategyId(family, scope, bankResult)` → string, encoding the vocabulary above.
- Set the value on each of the three return sites (financial-not-blocked at ~196, financial-blocked at ~203, industrial at ~321). Expose it on `PipelineResult` as `pipelineStrategyId: string`.

**Step 2 — Thread it into the envelope builder (`src/engine/analysisTraceability.ts`):**
- Remove imports at lines 21-22 (`selectStrategy`, `./pipeline/strategies` side-effect).
- Replace the `selectStrategy(...)` block at 463-472 with consumption of a new optional param `params.pipelineStrategyId` (best-effort: stamp only if present). Add `pipelineStrategyId?: string` to the builder's params type.
- At the envelope builder's call site (the code that constructs params from the `PipelineResult`), pass `result.pipelineStrategyId` through. (Call site to be located in Step 0; likely `auditSnapshot.ts` / `useAuditAnalysis.ts`.)

**Step 3 — Delete the spine:**
- `src/engine/pipeline/registry.ts`
- `src/engine/pipeline/strategy.ts`
- `src/engine/pipeline/strategies/bank.ts`, `nbfc.ts`, `insurance.ts`, `industrial.ts`, `index.ts`
- `src/engine/pipeline/__tests__/bank.spec.ts`, `industrial.spec.ts`, `nbfc-insurance.spec.ts`
- Remove the now-empty `src/engine/pipeline/` and `strategies/` dirs if nothing else lives there. (`computeRatios` in `regressionHarness.ts:149` and `pipeline.ts:250` is a DIFFERENT function — the recast-ratio computation — do NOT touch.)

**Step 4 — Add a focused test for the re-homed stamp:**
- New `src/engine/__tests__/pipelineStrategyStamp.spec.ts`: assert the stamp equals `bank-v1` for an auto-detected bank fixture (the case the OLD code got wrong → `industrial-v1`), `nbfc-v1` / `insurance-v1` for those, and `industrial-v1` for a plain industrial. This locks in the correctness fix.

**Step 5 — Supersede the ADR (docs):**
- Mark the strategy-spine ADR as Superseded with a short note: spine removed as premature abstraction over a 2-way fork; `pipelineStrategyId` retained and re-homed onto the dispatch fork; revisit a strategy pattern only when a sector needs genuinely different recast/ratio stages (e.g. REIT NAV-per-unit), not merely different bands.

## Files likely to change
- Edit: `src/engine/pipeline.ts` (helper + 3 return sites), `src/engine/analysisTraceability.ts` (imports + stamp block + params type), envelope-builder call site (TBD Step 0), the strategy-spine ADR under `docs/`.
- Add: `src/engine/__tests__/pipelineStrategyStamp.spec.ts`.
- Delete: 7 source files + 3 spec files listed in Step 3.

## Tests / validation
- `npm run typecheck`
- `npm test` (full) — expect the 3 deleted spec files gone, new stamp spec green.
- `npm run test:golden` — **must be unchanged**; this is the guardrail proving HDFC Bank / Bajaj Finance valuation did not move (no valuation code touched).
- Grep after deletion: no dangling import of `pipeline/registry|strategy|strategies`.
- `npm run validate` before PR.

## Risks, tradeoffs, and open questions
- **Stamp VALUE changes for auto-detected financials** (`industrial-v1` → `bank-v1`/`nbfc-v1`/`insurance-v1`). This is an intentional correctness fix, but it is a change to a persisted audit field's value going forward. Call it out in the PR body. Check for any existing test/snapshot asserting `industrial-v1` on a financial fixture and update it (Step 0 grep should surface).
- **No valuation risk by construction** — `processBankData` and `computeValuation` are untouched; golden tests are the proof.
- **Open question:** refine industrial stamp to `it-services` / `cyclical`? Recommend NO for this PR — keeps id vocabulary stable; revisit only if audit consumers ask for it.
- **Open question:** stamp value for the financial-**blocked** branch — proposal stamps the subtype id (path-accurate). Alternative: leave unset. Pick path-accurate unless a consumer expects unset on block.
- **Explicitly OUT of scope (separate follow-up):** the typed `SectorRatios`/`SectorBands` discriminated-union contract that would let `scopePolicy` (18 refs), `financialInstitutionFramework` (12), `ratioSanity` (2) consume a typed sector contract instead of each re-deriving "is this a bank?". That is the real leakage fix and the only thing a future strategy pattern would earn its keep on — but it is design-heavy, touches the golden-adjacent scoring bands, and must not ride along with a deletion PR. Track as its own ADR + plan.

## Iteration log
| # | Change | Why |
|---|--------|-----|
| 1 | Drafted delete + keep-stamp from user's recommendation | User's Option B analysis |
| 2 | Found stamp is sourced from `selectStrategy()` (analysisTraceability:466), not the fork — deletion would orphan it | Verified imports/usage; coupling makes re-home mandatory in same PR |
| 3 | Found current stamp is buggy for auto-detected financials (`selectStrategy` keys off `company_type`, fork keys off detected `family`) → re-home is a correctness fix, added Step 4 test to lock it | Cross-read pipeline.ts:156 vs registry `selectStrategy` + bank.spec.ts auto→industrial |
| 4 | Confirmed schema/migrations unaffected (field retained, free-form string) — no schema bump | observability.ts/auditRunStore.ts/envelopeMigrations.ts consume the string only |
| 5 | Scoped typed sector-bands contract OUT to a separate ADR/plan | Don't ride golden-adjacent band changes on a deletion PR |
| 6 | One-way-door checks: confirmed mis-stamp is GENERAL across all 3 financial subtypes (not bank-only); confirmed `generic-financial→nbfc` via detectSubtype precedence | User-requested pre-deletion verification; all `matches()` key off explicit company_type, catch-all returns true |
| 7 | Switched stamp source from `bankResult.subtype` → `detectSubtype(scope,...)`; then to the existing `bankSubtype` param (already populated by useAuditAnalysis:182) with scope fallback | bankResult is absent on the financial-blocked branch; bankSubtype param is already in-hand and is the true root cause the old code ignored |
| 8 | DROPPED Step 1 (pipeline.ts edits) entirely — builder self-resolves from params already passed; no recompute, no new params, no call-site threading | QualityGateReport.scopeAssessment (full ScopeAssessment) + bankSubtype both already reach the builder |

## DECISION NEEDED before this PR merges (one item)
**The 10x master-index has an `ls src/engine/pipeline/strategies/` acceptance gate** (`docs/architecture/plans/2026-05-28_to-10x-master-index.md`). Deleting the strategies dir makes that grep gate fail **by design** — it's the literal-10/10 tension. The plan supersedes ADR 006 and updates the doc references, but the grep gate itself needs an explicit call:
- **Option (i) — Amend the gate** to assert the *outcome* instead of the *mechanism*: grep that `pipelineStrategyId` is stamped + a stamp unit test exists, rather than `ls strategies/`. (Recommended — the gate was a proxy for "sector path is audited," which the re-home satisfies more honestly.)
- **Option (ii) — Mark the gate Superseded** in the master-index with a pointer to ADR 006's superseding note, and drop it from the scorecard.
- This is a scorecard-philosophy call, not a code call — flagging for the user rather than auto-deciding.
