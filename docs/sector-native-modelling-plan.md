# Sector-Native Modelling — Rigorous Remediation Plan

**Status:** Phase 0 SHIPPED (telecom/utility fail-safe). Phases 1–4 proposed.
**Author:** drafted with Claude Code, grounded by two code-state exploration passes (see §0)
**Scope:** Make the engine sector-faithful (or fail-safe) for banks/NBFCs, insurers, telecom, and utilities — so no company receives a confident valuation built on the wrong economic model.

---

## 0. Grounding corrections (two assumptions in the first draft were WRONG)

A second Opus-pinned grounding pass against real source + corpus corrected two claims from the initial draft:

1. **Insurance does NOT silently fall back to Gordon.** The first draft (and my verbal answer) said insurers without an EV sidecar fall to a generic Gordon P/B 0.7×. That is **wrong**. `computeBankValuation.ts:163-181` **fails closed**: when `embedded_value` is absent, `triangulatedValue = null` (no blessed number), and Gordon/RI/DDM render only as displayed *sanity-range brackets*, never as the headline value. The 0.7× is the insurance P/B *floor* inside `justifiedPBGordon` (`coreModels.ts:55`), not a fallback. There is a dedicated `insuranceEvFailClosed.spec.ts`. The EV multiples are also IRDAI-cohort-aware (`config.ts:102-105`: "PSU/LIC ~1.0x EV, private/HDFC Life ~3.5x"). **So Phase 1 is largely already done** — see revised Phase 1.

2. **The first draft's proposed telecom/utility labels don't exist.** Capitaline `.xls` exports use a *universal master template* — every company's file contains all ~1600 row labels, so label *presence* is meaningless; only material (≥1 Cr) values signal. The draft's `"Spectrum"`, `"AGR"`, `"Rate Base"`, `"Power Purchase"`, `"Generation"` are NOT real material Capitaline keys and would never match. The VERIFIED clean discriminators (read from Vodafone Idea / NTPC / Power Grid real data) are:
   - **telecom** → `"Direct Tele Communication / Network Development Expenses"` (Vodafone Idea 5,772 Cr — the one telecom-exclusive opex line).
   - **utility** → `"Regulatory Deferral Account - Debit Balance"` / `"- Credit Balance"` (Ind-AS 114 rate-regulated; NTPC 18,730 Cr / Power Grid 9,876 Cr — unique to rate-base utilities).
   - Deliberately NOT triggers: `"Rights Under Licensing Agreement"` / `"License Fee / Operation Charges"` — they also fire materially in Power Grid, so they'd cross-contaminate telecom↔utility.

**Corpus fact:** all four telecom/utility companies are present with real .zips (Bharti Airtel, Vodafone Idea, NTPC, Power Grid), so the labels above are verified, not guessed.

---

## 1. Corrected picture (this supersedes the earlier "4 sectors all broken" framing)

| Sector | Detection | Pipeline | Recast | Valuation | Reconciliation | Fail-safe today |
|--------|-----------|----------|--------|-----------|----------------|-----------------|
| **Bank** | ✅ `scopePolicy.ts:48-54` signals | ✅ `bankPipeline.ts` | ✅ own metrics (NIM, NPA, CRAR) | ✅ Gordon P/B, ERI, DDM | ✅ `bankReconciliationResiduals.ts` | n/a (handled) |
| **NBFC** | ✅ `scopePolicy.ts:72-95` signals | ✅ `bankPipeline.ts` | ✅ own metrics | ✅ + P/AUM, ROA×lev, CRAR/ECL governors | ✅ subtype-aware | n/a (handled) |
| **Insurance** | ✅ `scopePolicy.ts:57-69` signals | ⚠️ `bankPipeline.ts` | ❌ none (`periods: []`) | ⚠️ EV-based **only if sidecar present**, else Gordon 0.7× | ⚠️ combined-ratio check only | ⚠️ blocks only when mixed w/ bank |
| **Telecom** | ❌ **no signals** | ❌ **industrial** | ❌ industrial NOA/NFO | ❌ industrial RNOA/ReOI | ❌ industrial identities | ❌ **none — silent** |
| **Utility** | ❌ **no signals** | ❌ **industrial** | ❌ industrial NOA/NFO | ❌ industrial RNOA/ReOI | ❌ industrial identities | ❌ **none — silent** |

**Conclusion:** Banks/NBFCs are mature. The defensibility risk is concentrated in **telecom/utility (silent industrial misvaluation, no fail-safe)** and secondarily **insurance (no recast, sidecar-dependent EV)**.

### Why the industrial model misfires per sector
- **Telecom** — spectrum/licence intangibles and AGR regulatory liabilities have no operating/financial home; lease/ROU is huge. They fall into the `OA_Other` balancing plug (`recast.ts:143-144`), so NOA and therefore RNOA/kw are quietly wrong. The ratio-sanity bands at `ratioSanity.ts:109-118` only fire if `company_type` is *manually* set to `telecom` — auto-detection never sets it.
- **Utility** — rate-base-regulated firms earn ≈ their allowed return by construction, so the RNOA−kw "value-creation spread" is near-zero by design; the industrial frame reads a sound regulated business as creating no value, and structural leverage as risk.
- **Insurance** — float (`policyholderFunds`) funds an investment portfolio; the canonical frame is actuarial (embedded value, VNB, combined ratio), not accrual ReOI. The engine handles this correctly: it runs an IRDAI-aware EV model when a sidecar supplies `embedded_value`, and **fails closed** (no blessed value) when it doesn't — see §0 correction.

---

## Phase 0 — De-risk & fail-safe ✅ SHIPPED

**Goal:** Stop silent misvaluation before building anything sector-native. A correct "we can't value this rigorously yet" beats a confident wrong number.

**As-built (differs from the first draft — see §0):**

### 0.1 Open questions resolved ✅
- All four telecom/utility companies present with real .zips (Bharti Airtel, Vodafone Idea, NTPC, Power Grid). `company_type` lives in `companies-metadata.json`, not `expectations.json`.
- EV multiples ARE IRDAI-cohort-aware (`config.ts:102-105`); insurance fails closed without a sidecar. Phase 1 largely pre-existing.

### 0.2 Telecom/utility detection ✅ (`scopePolicy.ts`)
- Added a **separate** `INDUSTRIAL_SECTOR_GROUPS` table — NOT into `SIGNAL_GROUPS` (which routes to the financial family). Load-bearing decision: telecom/utility must stay `analysisFamily: "industrial"`.
- **Verified** discriminators (real Capitaline data, not the draft's guesses): telecom → `"Direct Tele Communication / Network Development Expenses"`; utility → `"Regulatory Deferral Account - Debit Balance"` / `"- Credit Balance"`.
- Conservative: requires the discriminator material (≥1 Cr) in **≥2 periods**. Detection runs ONLY when no financial signal fired (a bank with a stray telecom line is never reclassified). Also intercepts explicit `company_type: telecom|utility`.
- New classifications `"detected-telecom-unmodelled"` / `"detected-utility-unmodelled"` default to the industrial family (no change to `analysisFamilyFromScope`).

### 0.3 Rigor-ladder cap ✅ (`analysisTraceability.ts`)
- Derives `sectorUnmodelledCapsAtPlausible` from `qualityGate.scopeAssessment.classification` and ANDs `!cap` into the `achieved` of valuation-eligible + production-ready, with explicit cap-reason `detail`. Because `currentLevel` = highest achieved checkpoint, this makes **economically-plausible the ceiling**. Not a block — the recast + sector-correct ratios still run, but the intrinsic value is produced-but-not-blessed.

### 0.4 Ratio-band auto-resolution ✅ (`pipeline.ts`)
- Extended the `industrialEffectiveType === "auto"` block to map detected telecom/utility → the (already-present) `BANDS.telecom` / `BANDS.utility`, ahead of the cyclical heuristic. `ratioSanity.ts` unchanged.

**Result:** full suite 1642 passed / 9 skipped; golden 7/7 byte-stable (golden companies carry no discriminators); NTPC/Power Grid now correctly capped. Tests: extended `scopePolicy.spec.ts` (detection + conservatism + financial-wins-over-stray-line) and new `sectorLadderCap.spec.ts` (cap fires for telecom/utility, not for industrial).

---

## Phase 1 — Insurance: optional hardening (mostly ALREADY DONE — re-scoped after §0)

**Current (corrected):** `bankPipeline.ts:137-181` computes claims/expense/combined ratios and float metrics; `coreModels.ts:166-198` runs the IRDAI-aware EV model when the sidecar provides `embedded_value`, and **fails closed** (`computeBankValuation.ts:163-181`, `triangulatedValue = null`) when it doesn't — Gordon/RI/DDM are displayed only as sanity brackets, never as the headline value. So the "silent fallback" risk does NOT exist. The remaining items below are *optional* enhancements, not defect fixes.

### 1.1 (OPTIONAL) Derive a fallback EV proxy when no sidecar
- The current fail-closed behaviour is already honest. This is a *coverage* enhancement, not a correctness fix: when `embedded_value` is absent, optionally compute a transparent appraisal-value proxy (adjusted net worth + capitalised VNB run-rate from premium growth × new-business margin), tagged `confidence: proxy` so it's clearly not a reported EV. Only worth doing if analysts frequently lack sidecar EV.
- **Guard (already met):** if neither sidecar EV nor proxy inputs exist, the model already skips-with-reason and fails closed — preserve that.

### 1.2 Insurance reconciliation residuals (genuine, fail-closed)
- **File:** `bankReconciliationResiduals.ts` — today insurance gets only `insurance-combined-ratio < 1.5`. Add: float-to-investment-asset coverage (policyholder funds should be backed by investment assets within tolerance), premium↔claims↔reserve flow consistency. Same non-tautological, independent-read discipline used in `reconciliationResiduals.ts` (compare independently-reported lines, not algebraic identities).

### 1.3 Calibration (gated on Phase 0.1 finding)
- If EV multiples are generic, recalibrate `ev_multiple`/`vnb_multiple` defaults to Indian listed-insurer norms with a cited source, tagged by cohort/year (mirror the threshold-calibration discipline planned in the master rigor plan).

**Verify:** captured fixture for one listed insurer (e.g. HDFC Life / SBI Life shape); assert EV-based path runs both with and without sidecar; reconciliation fails closed on a corrupted float line.

---

## Phase 2 — Telecom: sector-native recast

**Prereq:** Phase 0 fail-safe is live (so this is an upgrade, not a panic fix).

### 2.1 Spectrum & licence/AGR classification
- **Files:** the Capitaline mapping spec (`mappingSpec.ts`, consumed at `recast.ts:24-25`), `recast.ts`.
- The verified telecom lines (from Vodafone Idea real data): `"Rights Under Licensing Agreement"` (spectrum/licence intangible, 154,412 Cr) → **operating assets** (they generate operating revenue), not the `OA_Other` plug; `"License Fee / Operation Charges"` (AGR revenue-share to DoT, 3,137 Cr) → surfaced as a distinct regulatory charge rather than absorbed into generic opex.
- Lease/ROU already handled industrially; verify the telecom magnitude doesn't distort the operating/financing boundary.

### 2.2 Telecom ratio/valuation adjustments
- Telecom is closer to industrial than banks are, so the goal is a *corrected* NOA/kw, not a parallel pipeline. Once spectrum/AGR are correctly bucketed, the existing ReOI machinery applies. Add EV/EBITDA and per-subscriber sanity cross-checks (telecom-native multiples) as triangulation, not as the primary gate.

### 2.3 Lift the Phase-0 cap
- Once recast is sector-faithful and reconciliation passes, allow telecom to reach `valuation-eligible` again — gated on a telecom-specific reconciliation residual (spectrum + AGR coverage) passing.

**Verify:** captured fixture (Bharti / Vodafone Idea shape — Vi already referenced in `vodafoneIdea.spec.ts`); assert spectrum lands in OA, AGR in its own class, NOA changes vs the pre-fix industrial recast in the expected direction.

---

## Phase 3 — Utility: regulated-return framework

**Prereq:** Phase 0 guarded stance is live.

### 3.1 Rate-base recognition
- **Files:** mapping spec + `recast.ts`.
- Identify regulated rate-base assets; the value question for a utility is "allowed return vs. cost of capital on the rate base," not RNOA−kw on accrual NOA. Add a rate-base-return lens alongside (not replacing) the industrial output.

### 3.2 Don't punish zero-spread-by-design
- **File:** `analysisTraceability.ts` / the value-creation interpretation.
- A regulated utility earning ≈ its allowed return is healthy; ensure the trust envelope does not flag near-zero RNOA−kw spread as a red flag for utilities. This is an interpretation/labelling fix, not a number change.

### 3.3 Utility valuation lens
- Regulated-asset-base (RAB) × allowed-return model as the primary lens; DDM as secondary (utilities are dividend-heavy). Surface both with the spread interpretation corrected.

**Verify:** captured fixture (NTPC / Power Grid shape — both referenced in the master rigor plan as mandatory companies); assert the RAB lens runs and the envelope does not red-flag a healthy regulated spread.

---

## Phase 4 — Cross-cutting hardening (after sector paths exist)

- **Strategy spine resolution (ADR-006):** today dispatch is family-based (`industrial` vs `financial-institution`) at `pipeline.ts:146-156`; the `selectStrategy` spine is metadata-only. With four+ real sector paths, decide: make the spine load-bearing (each sector implements recast/ratios/value) OR keep family-dispatch and delete the dead spine. Don't leave it ambiguous.
- **Rigor ladder per-family contract:** banks already use a separate reconciliation pathway and never reach industrial `production-ready`. Make the ladder's family-conditional gating explicit and tested per sector (production-ready / valuation-eligible / guarded / blocked) so an upstream change can't silently regress a sector.
- **`test:audit` shards:** extend the audit-all-companies expectations to cover at least one company per sector, so sector regressions are caught at release.

---

## Verification strategy (per the project's existing gates)

- Each phase ships independently and must keep `npm run validate` green and golden **7/7 byte-stable** (sector work must not perturb industrial fixtures — verify the industrial recast path is untouched by additive sector branches).
- New sector fixtures captured via the existing `scripts/refresh-company.mjs` flow, with `expectations.json` ranges (RNOA/ROE/EV bands) as the regression gate.
- Reconciliation additions must be **non-tautological and fail-closed** — the discipline proven in #237/#238/#239: compare independently-read raw lines, fail the ladder on corruption, never compare a value to itself.
- Adversarial review (multi-agent, refute-by-default) on each sector recast diff before merge.

## Scope guards

- Sector work is **additive**: the industrial recast and its golden fixtures are not modified. New sectors branch at dispatch (`scopePolicy.ts` / `pipeline.ts`), not inside the industrial recast.
- Fail-safe (Phase 0) is the only mandatory phase; Phases 1–4 are independently shippable and independently valuable. If work stops after Phase 0, the product is *honest* about what it can't value — which is the real defensibility bar.
- No sector path silently falls back to the industrial model: detected-but-unmodelled → guarded with an explicit reason, never a confident industrial number.

---

## Recommended order (impact-per-hour)

1. **Phase 0** — fail-safe for telecom/utility. Smallest surface, kills the worst silent-misvaluation risk. Do this even if nothing else follows.
2. **Phase 1** — insurance EV hardening. Medium surface, removes sidecar fragility on an already-detected sector.
3. **Phase 2** — telecom recast. Larger, but Vi fixture already exists.
4. **Phase 3** — utility RAB framework. Larger, needs NTPC/Power Grid fixtures.
5. **Phase 4** — cross-cutting (strategy spine, per-family ladder contract, audit shards).
