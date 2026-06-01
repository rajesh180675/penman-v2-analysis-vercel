# Poly-Paradigm Valuation — Plan to 10/10 Functional Rigor

**Status:** In progress toward 10/10. Phase 0 sector fail-safe shipped (#240); Phase 1 cash lens + cross-paradigm gate shipped (#241/#242); CV denominator guards shipped (#243).
**Author:** drafted with Claude Code.
**Thesis:** Keep Penman-Nissim as the *accrual lens*, add genuinely **independent** valuation lenses, and make the rigor layer **adjudicate disagreement** between them — not triangulate variations of one recast.

---

## 0. Grounding confidence (read this first)

This plan is built from a grounding pass that **partially** completed (API quota was hit mid-run). Sections are tagged by how well-grounded they are, so nothing here repeats this session's earlier ungrounded-assumption failures (the tautological #89 fix, the speculative telecom labels):

- ✅ **VERIFIED this pass** (file:line confirmed): §1 model-independence audit, §2 cross-paradigm reconciliation gate. These are the load-bearing parts.
- 🟡 **VERIFIED earlier this session**: §3 sector-native (Phase 0 shipped), §5 CV-collapse (read directly in `computeValuation`).
- ⚠️ **NOT re-grounded this pass — verify before implementing**: §4 optionality lens, §5 AEG mis-scaling + anomaly thresholds, §6 data-bridging. The grounding agents for these failed; claims rest on earlier-session context + general knowledge and MUST be re-verified against source before any code is written.

---

## 1. ✅ The core finding — most "models" are one recast in six hats

`computeValuation` (`PenmanNissimEngine.ts:90-381`) produces seven outputs that are all **algebraic rearrangements of the same residual-income recast** under clean surplus:

| Output | file:line | Reads from |
|--------|-----------|-----------|
| RE / V_RE_CV3 | :107, :330-332 | recast (CNI, CSE, ke) |
| ReOI / V_ReOI | :107, :337-339 | recast (OI, NOA, kw) |
| "FCFF" EV_FCFF | :206-219 | recast — **OI−ΔNOA, NOT cf.CFO** |
| "FCFE" V_FCFE | :207-220 | recast — CNI−ΔCSE |
| AEG | :222-234 | recast (CNI, ke) |
| DDM | :277 | recast/cash hybrid |
| Growth-accounting | :183-193 | recast |

Under clean surplus, **RE≡FCFE and ReOI≡FCFF≡AEG** — the same information rearranged. They cannot genuinely disagree except via rounding and terminal-anchor choice. The code itself concedes this, demoting FCFF/FCFE to "diagnostic cross-checks" (`helpers.ts:139-141`).

**Genuinely independent sources that exist today** (do NOT read the recast):
- **Owner-earnings DCF** — `helpers.ts:275-290` + `solvers.ts:24-36`, base = `cf.CFO − maintenance capex`. The *only* genuine cash-statement DCF. Blended via **median** with RE/ReOI into every scenario card (`helpers.ts:53-60`).
- **Damodaran CAPM ke** — `builders.ts:127-133`, industry levered beta.
- **EV/EBITDA** — `core.ts:197-200`, peer multiples + market cap.
- **Reverse-DCF Monte Carlo** — `builders.ts:135-153`, market price + historical `FCF_cash` margins.
- **SOTP** — `builders.ts:27-77`, segment operating value.

**The single highest-leverage gap (verified):** `recast.ts:346` computes `FCF_cash = CFO − Capex` but **nothing ever discounts it into a value** — it's used only as a Monte-Carlo margin input. There is no forward FCFF DCF built from the cash-flow statement. That is the missing independent cash lens.

**Divergence is cosmetic today:** `computeCrossCheckSpread` (`helpers.ts:62-75`) flags only when methods drift >50%, and the consequence is a sentence appended to the summary (`helpers.ts:252-264`). It does NOT touch the rigor ladder.

---

## Phase 1 — ✅ The poly-paradigm spine (highest value; fully grounded)

### 1.1 Independent cash-lens FCFF DCF ✅ SHIPPED (#241/#242)
**Files:** new `src/engine/cashFlowDcf.ts`; wired into `valuationCommandCenter/core.ts`.
- Build a forward FCFF DCF directly from the cash-flow statement: project `FCF_cash = CFO − Capex` (`recast.ts:346`, already computed per period) forward, discount at kw (`resolveKw`), bridge EV→equity via `−NFO −MI`. This is a *genuinely independent* leg — it reads cash, not accrual NOA.
- Surface it as a first-class triangulation method alongside RIV and relative, NOT folded back into the median blend (keep it separable so the gate in 1.2 can see it disagree).
- **Blast radius:** additive; does not touch `computeValuation`. **Golden risk:** none if it's a new output the existing tests don't assert.

### 1.2 Cross-paradigm reconciliation gate ✅ SHIPPED (#242)
**Files:** `src/engine/analysisTraceability.ts`, `src/engine/reconciliationResiduals.ts`, `src/engine/valuationCommandCenter/core.ts`.

The grounding gave the exact, faithful-to-#238 hook:
1. The three independent valuations exist but live in `buildValuationCommandCenter` (`core.ts`), where the reconciliation evaluator can't see them (reconciliation runs inside `buildAnalysisTraceability`, valuation out of scope — documented at `analyticalDepth.ts:14-17`).
2. **Pass them in via a new optional param** to `buildAnalysisTraceability`, mirroring the existing `bankMetrics?`/`bankSubtype?` optional inputs (`analysisTraceability.ts:164-165`).
3. Build a `valuation-triangulation` `ReconciliationResidualCheck` via the existing `buildCheck` (`reconciliationResiduals.ts:122-136`): `residual = max pairwise |Δ| across {RIV per-share, cash-DCF per-share, relative-implied per-share}; ratio = residual / median`.
4. **Merge it into the `reconciliation` summary** (`reconciliationResiduals.ts:577-585`) so it rides BOTH fail-closed seams:
   - HARD gate: `structuralAchieved` requires `reconciliation.status !== "failed"` (`analysisTraceability.ts:307`) → caps the whole ladder.
   - SOFT downgrade: `reconPenalty = min(30, maxResidualRatio*100)` at 20% weight (`:403-408`) → downgrades production-ready.
5. **Thresholds:** ~15% warn / 30% crit (clone the `ol-coverage-bridge` classifier band at `reconciliationResiduals.ts:439-454` — value triangulation is noisier than the 1%/5% balance-sheet bridges).
6. **Honesty rule (critical):** null-skip (return null, like `buildOptionalCheck`) whenever fewer than two methods produced a finite value. Absence of evidence is not divergence — this is the same skip-don't-fail discipline as the kw-consistency check.

**This is the thesis in miniature:** rigor stops meaning "we computed one number carefully" and starts meaning "three independent paradigms agree — or we tell you, and fail closed, when they don't."

**Verification:** a fixture where the three methods agree → confirmed; where one diverges >30% → `reconciliation.status === "failed"`, ladder caps. Golden 7/7 byte-stable (real companies' methods agree within band — verify empirically first, as with #89).

---

## Phase 2 — 🟡 Sector-native recast (lift the Phase-0 cap)

Phase 0 (#240) detects telecom/utility and caps them at economically-plausible. This phase makes the recast faithful so the cap can lift.

- **Telecom:** ✅ recast-detail slice shipped and cap-lift predicate shipped. `Rights Under Licensing Agreement` is surfaced as telecom spectrum/licence operating intangible detail, network/licence opex is explicit in the operating-cost bridge, and `telecom-sector-native-readiness` removes only the blanket telecom cap when trace-backed spectrum + network opex evidence is confirmed. Remaining: telecom-native EV/EBITDA / per-subscriber cross-checks and real-company fixture ranges.
- **Utility:** rate-base × allowed-return lens; stop the envelope flagging a healthy regulated near-zero RNOA−kw spread as value-destruction.
- **Lift gate:** telecom now uses a confirmed sector-native readiness residual before the blanket cap can lift; utility still needs its RAB-specific residual/lens before cap lift.

---

## Phase 3 — ⚠️ Optionality lens (VERIFY FIRST)

⚠️ **Not re-grounded this pass.** Earlier-session context showed `mertonRegimeEngine` exists (`computeMertonCredit`, `computeRegimeConditionalValuation`) and `detectDistress` / `lossMaker` flags exist — but I have NOT verified what the Merton engine actually does or how distressed/pre-monetization firms (Paytm, Vodafone Idea) are valued today. **Before implementing:** ground (a) whether any real-options code exists, (b) whether distressed firms get a blessed accrual value or a guard.

Intended: a real-options lens (option-to-abandon / option-to-expand) for the businesses accrual-RIV structurally mis-prices — deep cyclicals at trough, pre-monetization, distressed. Routed like the sector lenses: when a firm is flagged optionality-dominant, the accrual value is capped/guarded and the optionality lens leads.

---

## Phase 4 — ⚠️ Mechanical correctness tail (partially shipped)

- ✅ **CV silent-collapse-to-zero:** fixed in #243. Gordon-style terminal CVs now fail closed with explicit `continuingValueGuards` when terminal growth is not safely below the relevant discount rate; invalid terminal spreads no longer become silent zeros.
- ✅ **AEG mis-scaling:** fixed in this workstream. The Ohlson-Juettner/Penman AEG lens now capitalizes forward earnings at `ke` (not `1+ke`), divides discounted AEG by `ke`, and includes the `ke × prior distribution` dividend-displacement term. Load-bearing invariant: full-payout no-growth clean-surplus firms have zero AEG and agree with RE/DDM.
- ⚠️ **Anomaly-threshold calibration:** `ratioSanity` BANDS, `RNOA_JUMP_THRESHOLD`, `economicSanityGates` — confirm which are magic numbers vs cohort-tagged, then tag/recalibrate against the 33-company corpus.

---

## Phase 5 — ⚠️ Data-bridging layer (VERIFY DATA INVENTORY FIRST)

⚠️ **Not re-grounded this pass.** Known from Phase 0 grounding: `companies-metadata.json`, `registry.json`, `expectations.json` (5 companies), and `quality_indicators` sidecars exist. **Unverified:** whether annual-report PDFs/text are on disk (the master plan noted `.vercelignore` excludes `annual_reports/`, suggesting they exist but are inert) and whether anything consumes them.

The opportunity (the user's point): on-disk-but-unused data is a **cross-validation source** for the poly-paradigm gate. Concretely:
- **AR management guidance vs reverse-DCF implied growth** — if the filing's stated growth outlook contradicts the market-implied growth the reverse-DCF backs out, that's a first-class signal.
- **Segment disclosures vs SOTP** — validate the SOTP segment split against reported segment revenue/assets.
- **Sidecar actuals (EV, NPA, CRAR) vs computed proxies** — already partially wired for insurance EV; extend.

**Before implementing:** ground the actual data inventory (what's on disk, what's parsed, what's inert) — this is exactly the kind of claim that must be verified, not assumed.

---

## What "10/10" honestly means

10/10 is **not** a foundation swap. Penman-Nissim is the right accrual anchor (RIV≡DCF≡AEG under clean surplus — there is no superior universal first principle, only re-coordinatizations). The constraint is *monocentrism*, and the cure is pluralism above the spine, which is what Phases 1-5 deliver.

**Asymptotic / never-truly-done** (be honest with stakeholders): threshold calibration drifts with each market cycle; sector-native models are never exhaustive (the next unusual company always exists); optionality valuation is inherently assumption-heavy. "10/10" means *the rigor layer adjudicates disagreement between independent lenses and fails closed honestly* — not that any single number is perfect.

## Recommended order (impact-per-hour)
1. ✅ **Phase 1** — independent cash-DCF + cross-paradigm gate shipped (#241/#242).
2. ✅ **Phase 4 CV-collapse** — shipped (#243).
3. ✅ **Phase 4 AEG scaling** — fixed in this workstream.
4. **Phase 2** — sector-native recast (lift the cap).
5. **Phase 3 / 5 / anomaly-threshold calibration** — only after re-grounding each (their grounding agents failed this pass).
