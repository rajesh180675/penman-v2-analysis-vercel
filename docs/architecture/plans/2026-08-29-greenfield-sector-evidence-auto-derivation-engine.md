# Greenfield: Sector Evidence Auto-Derivation Engine (SEADE)

**Date:** 2026-08-29  
**Status:** Milestones A+B+C shipped. A (types/engine/telecom/utility), B (cyclical), C (audit-harness wiring + scorecard credit). D (retail/conglomerate derivation + reviewer provenance export) pending.  
**Author:** Hermes deep-dive (codebase grounded)  
**Builds on:** PVRE (shipped today), sector-native case calculators (partially-wired), reconciliation readiness residuals (shipped)

---

## 1. Why this, and why now

Deep-dive findings (grounded in repo, not aspiration):

| Finding | Evidence |
|---|---|
| Scorecard 7.6/10, **Sector-native coverage 4.0/10** — the lowest family | docs/valuation-maturity-scorecard.md |
| 11/33 companies blocked: telecom, utility, cyclical, conglomerate, loss-maker routed through generic industrial models | same doc, Row Blocker Ledger |
| Sector-native case calculators exist (`src/engine/sectorCases/calculators.ts`) with production formulas and fail-closed guards | src/engine/sectorCases/ |
| Cases are **"partially-wired"** — the audit harness never invokes them because it cannot auto-derive the required operational inputs | src/engine/sectorCases/execution.ts, scripts/lib/auditCompanyRun.ts |
| Platform API requires manually-reviewed `GovernedSectorSidecarApproval` — no auto-population path exists | server/routes/platform.ts, src/app/platformGovernance.tsx |
| Reconciliation residuals already extract the raw evidence (spectrum, PPE, CWIP, regulatory deferrals) but only for readiness checks, not for case inputs | src/engine/reconciliationResiduals.ts:245-339 |
| 33-company corpus has parsed financials on disk (`.xls` + ZIP) — the raw material for derivation is present | public/data/companies/ |

**The honest gap:** The system can *detect* that a company is telecom/utility/cyclical, can *check* that sector evidence exists for reconciliation readiness, but cannot *convert* that evidence into the typed case inputs the sector-native calculators need. The calculators sit idle while companies are capped at "economically-plausible" and routed through generic industrial models that structurally mis-price them.

This is not a model-correctness issue (the formulas are shipped and tested). It is not a data-ingestion issue (the data is parsed). It is a **derivation and wiring** issue: the bridge from "evidence exists in the balance sheet" to "case input is populated and the calculator runs" is missing.

## 2. Scope: what SEADE is (and is not)

**In scope (new module `src/engine/seade/`)**

1. **Evidence-to-case-input derivation.** Read the existing parsed financials (balance sheet, P&L, cash flow, segment data) and auto-derive the operational inputs each sector case requires:
   - **Telecom:** subscribers (from revenue/ARPU back-calculation or segment data), ARPU, spectrum renewal capex %, maintenance capex % revenue, EBITDA margin, net debt, spectrum obligations, lease liabilities.
   - **Utility:** regulated rate base (PPE + CWIP × eligibility + regulatory deferrals), regulated equity weight, allowed ROE (from sector template priors), cost of equity, terminal growth, net debt.
   - **Cyclical:** normalized volume, mid-cycle price, cash cost, fixed costs, sustaining capex (from historical cycle analysis across periods).
   - **Retail:** mature store count, revenue per store, store EBITDA margin, central costs, maintenance capex per store.
   - **Conglomerate:** segment-level SOTP inputs already partially wired; extend to auto-derive discount % and holding-company net debt.

2. **Deterministic derivation with provenance.** Every derived input carries a `DerivationProvenance` record: which source fields were read, which formula was applied, which prior (sector template or historical median) was used when direct observation was unavailable. This makes derivation auditable, not magical.

3. **Fail-closed derivation.** When evidence is insufficient, return `status: "insufficient-evidence"` with explicit missing fields — never fabricate inputs. The existing `SectorOnboardingRow.status: "blocked"` mechanism already handles this; SEADE feeds it.

4. **Audit harness integration.** `auditCompanyRun.ts` gains a pre-valuation step: detect sector → derive case inputs → if derivation succeeds, invoke `executeCatalogSectorCase` → include the result in the audit row's model set and valuation evidence. The existing `sector-contract` blocker should drop from 11 to near-zero for companies with sufficient data.

5. **Scorecard re-rating.** After SEADE, the Sector-native coverage family should move from 4.0 to a measurable higher score. The exact target depends on how many of the 11 blocked companies have sufficient data for auto-derivation (estimate: 6-8 of 11).

**Explicitly out of scope (do NOT duplicate in-flight work):**
- No new sector-native models (poly-paradigm Phase 2 owns telecom/utility/cyclical model *formulas* — SEADE only wires the *inputs* to existing formulas).
- No rewrite of the executor/pipeline (native migration owns stages 1-14).
- No UI migration off legacy projections (native migration Wave 1/2/3 owns tab moves).
- No new data ingestion (Capitaline/ar-sidecar owners).
- No changes to PVRE (PVRE samples uncertainty around a base case; SEADE produces the base case for sector-native companies).

## 3. Architecture

```
  existing parsed data (RecastPeriod[], SegmentData, BankQualityIndicators)
                        |
                        v
        SEADE input adapter (read-only mapping)
                        |
      +-----------------+------------------+
      |                                    |
  Sector detector                    Evidence extractor
  (company_type + scope)             (bs/cf/is fields, segment data)
      |                                    |
      v                                    v
  Case type resolver <-------------> Derivation engine
  (registry require)               (per-sector formulas)
                                           |
      +-----------------+------------------+
      |                                    |
  Provenance ledger                Fail-closed gate
  (source refs, formulas)          (missing fields list)
      |                                    |
      v                                    v
  Typed SectorCaseInput            Insufficient-evidence result
      |                                    |
      +-----------------+------------------+
                        |
                        v
        executeCatalogSectorCase (existing)
                        |
                        v
        Audit row model set + valuation evidence
```

**Key contracts (TypeScript, in `src/engine/seade/types.ts`):**

```typescript
export interface DerivationProvenance {
  readonly sourceFields: readonly string[];        // e.g. ["bs.OA_TelecomSpectrumLicenses", "is.Sales"]
  readonly formula: string;                        // human-readable derivation rule
  readonly priorUsed: string | null;               // sector template key if no direct observation
  readonly confidence: "high" | "medium" | "low";  // based on direct vs prior-derived
}

export interface DerivedSectorCaseInput<T extends SectorCaseType> {
  readonly caseType: T;
  readonly issuerId: string;
  readonly asOf: string;
  readonly inputs: Extract<SectorCaseInput, { caseType: T }>;
  readonly provenance: Readonly<Record<string, DerivationProvenance>>;
  readonly missingEvidence: readonly string[];
  readonly derivationStatus: "ready" | "insufficient-evidence" | "not-applicable";
}

export interface SeadeResult {
  readonly derived: DerivedSectorCaseInput<SectorCaseType> | null;
  readonly onboardingRow: SectorOnboardingRow;  // existing type, fed by SEADE
}
```

**Integration points (existing seams, no god-function edits):**
- Input read: after `processCompanyDataFull` produces `PipelineResult` with `periods` and `segmentData` — the same data reconciliation residuals already read.
- Derivation: pure functions, deterministic, no I/O. Each sector has its own derivation module (`telecomDerivation.ts`, `utilityDerivation.ts`, etc.).
- Case execution: `executeCatalogSectorCase` from `src/engine/sectorCases/execution.ts` — already tested, already wired into `legacyExecutor.ts` for manually-approved sidecars.
- Audit output: extend `auditCompanyRun.ts` `industrialMetricsSnapshot` and `modelApplicability` to include sector case results when derived.

## 4. Rigor-level impact

Targets the **lowest scorecard family** directly:

| Scorecard family | Current | After SEADE | How |
|---|---|---|---|
| Sector-native coverage | 4.0 | 6.5-8.0 | 11 blocked companies → auto-derived cases run; fail-closed for insufficient data |
| Traceability/reconciliation | 5.0 | 5.5-6.0 | Sector readiness residuals now feed actual valuations, not just caps |
| Industrial core valuation | 8.0 | 8.0 | Unchanged — SEADE only adds sector-native paths, doesn't touch industrial |

**Honest constraints:**
- Not all 11 companies will have sufficient data. DMART (retail) needs store-count data that may not be in Capitaline exports. PAYTM (loss-maker) may remain blocked until the loss-maker profitability-path model is wired. SEADE must be honest about which companies it can help.
- Auto-derived inputs are **estimates**, not reviewed sidecars. The platform API's `GovernedSectorSidecarApproval` path remains the gold standard for production-ready rigor. SEADE gets companies to `valuation-eligible` with sector-native models; production-ready still requires human review of the derived inputs.
- Cyclical mid-cycle normalization requires judgment (which periods are "mid-cycle"?). SEADE uses a transparent, deterministic rule (e.g., median of last 5 periods' volume/price/cost) and surfaces the rule in provenance.

## 5. Build plan (small, verifiable increments)

1. **Milestone A** — Types + derivation engine skeleton + telecom derivation. Tests: unit (ITC/Bharti Airtel fixture), typecheck. Verify: derived telecom case input for BHARTIARTL passes `executeCatalogSectorCase` guards.
2. **Milestone B** — Utility + cyclical derivation. Tests: unit (NTPC, Tata Steel fixtures). Verify: derived cases produce finite values and are included in audit row model sets.
3. **Milestone C** — Audit harness wiring + scorecard re-run. Tests: audit spec for 3 sector companies, golden expectations updated for sector-native model inclusion. Verify: `sector-contract` blocker count drops.
4. **Milestone D** — Retail + conglomerate derivation (if data permits), provenance export to reviewer pack. Tests: unit + integration. Verify: reviewer can trace every derived input back to source fields.

Each milestone: `npm run typecheck`, targeted vitest, `npm run test:audit` for affected companies, golden tests updated only when the audit contract intentionally changes.

## 6. Risks & principled limits

- **Don't fabricate data.** If a required input cannot be derived from parsed financials or sector priors, return `insufficient-evidence` — never guess. The fail-closed discipline is more important than coverage.
- **Provenance is mandatory.** Every derived input must answer "where did this number come from?" in a way a reviewer can verify. This is the difference between rigorous estimation and magic.
- **Sector priors are policy, not truth.** When direct observation is unavailable, SEADE uses sector template priors (e.g., "telecom maintenance capex is typically 8-12% of revenue"). These are starting points, not facts. The prior key must be recorded in provenance.
- **Keep derivation deterministic.** No randomness, no I/O, no external calls. Same parsed data + same sector template = same derived inputs. This enables hashing and regression testing.
- **Respect the cap-lift gates.** Even after SEADE produces a sector-native valuation, the existing `telecom-sector-native-readiness` and `utility-sector-native-readiness` reconciliation checks must still confirm before the Phase-0 cap lifts. SEADE does not bypass these gates — it feeds them.

## 7. Why not just finish the roadmap instead?

The poly-paradigm roadmap owns model *correctness* (Phase 2 sector-native recast, Phase 3 optionality). The native migration owns *architecture* (14 stages, typed executor). SEADE owns *derivation* — the bridge from "we have the data" to "the existing model runs." It is orthogonal to both and unblocks the lowest scorecard family without colliding with in-flight work.

PVRE (shipped today) quantifies uncertainty around a base case. SEADE produces the base case for sector-native companies. Together they move the tool from "one generic model with uncertainty" to "the right model, with uncertainty, for each company type."
