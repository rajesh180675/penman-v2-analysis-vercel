# Valuation Maturity Scorecard

Generated: 2026-07-28T07:20:10.799Z
Schema: `2026-06-valuation-maturity-v2`
Overall score: **7.6/10** (guarded)
Audited corpus: 33 companies; total weight 100

## Current Baseline and Target

- Current score: **7.6/10**.
- Current rating: `guarded`.
- Target score: **10.0/10**.
- Target state: no supported company type is silently routed through the wrong valuation family; unsupported source or sidecar gaps are explicit expected skips, not crashes or green badges.
- Baseline artifact source: `npx tsx scripts/valuation-scorecard.ts --format md` over the audited company registry.
- Machine-readable source: `npx tsx scripts/valuation-scorecard.ts --format json`.

This score is intentionally conservative. It measures the current end-to-end corpus after the company-type-aware audit harness and skip/error taxonomy landed, not the aspirational 10/10 roadmap. A low family score is a work queue, not a reason to route companies through weaker generic models.

## Expected skips are not bugs

Expected skips are not bugs. They are deliberate fail-closed outcomes for cases where the model needs a source, sidecar, or support contract that is not present yet:

- `EXPECTED_SKIP_MISSING_SIDECAR` — a required sidecar such as insurance EV/VNB, source tieout, or another sector-specific source pack is absent.
- `EXPECTED_SKIP_INSUFFICIENT_HISTORY` — the company has too few usable periods for the requested valuation or maturity gate.
- `EXPECTED_SKIP_UNSUPPORTED_SOURCE` — the current source mode or source artifact is not yet covered by the required parser/diagnostic contract.

These rows should count against maturity until the missing contract is implemented, but they must not be reported as `CALC_ERROR`. A calculation error means the code failed or emitted invalid numeric output; an expected skip means the system refused to overstate confidence.

## Family Scores

| Family | Weight | Score | Status | Evidence | Blockers |
|---|---:|---:|---|---|---|
| Industrial core valuation | 15 | 8.0 | guarded | 12/33 audited rows are core industrial/consumer/IT-services; Outcomes: POLICY_WARNING | 12 core rows still carry policy/model/calculation blockers |
| Bank/NBFC/insurance coverage | 15 | 8.0 | guarded | 10/33 audited rows are banks, NBFCs, or insurers; Contributing model counts: 5, 4, 3 | — |
| Sector-native coverage | 12 | 4.0 | blocked | 11/33 audited rows need sector-native economics; Sector types: telecom, conglomerate, cyclical, utility +1 more | telecom remains routed through telecom-v1 instead of a sector-native model; conglomerate remains routed through industrial-v1 instead of a sector-native model; cyclical remains routed through cyclical-v1 instead of a sector-native model; utility remains routed through utility-v1 instead of a sector-native model; loss-maker remains routed through loss-maker-v1 instead of a sector-native model |
| Cross-paradigm independence | 12 | 9.0 | strong | 33 audited rows assessed for contributing valuation lenses; Model sets: VCC+SOTP+EPV+CASH_DCF, VCC+EPV, PB+ERI+DDM+P/AUM+ROA×LevRI, VCC+EPV+CASH_DCF +6 more; Triangulation methods: accrual-riv, cash-fcff-dcf, bank-pb, bank-eri +4 more; Independent lens groups: accrual-history, cash-statement, fi-asset-market-multiple, fi-book-residual-income +5 more | 1/33 audited rows still rely on a single valuation spine |
| Traceability/reconciliation/fail-closed gates | 16 | 5.0 | gap | Rigor levels: syntactically-valid, structurally-reconciled; Valuation readiness statuses: warning, guarded, production-ready; 0/33 audited rows reached production-ready rigor | 27 rows remain at syntactically-valid rigor; No audited row currently clears the production-ready gate |
| Data freshness/source tieout | 10 | 10.0 | strong | 33/33 audited rows have parsed periods; 33/33 audited rows expose latest period labels; 33/33 audited rows carry hashed source lineage; 33/33 audited rows carry fresh timestamped market evidence | source artifact hashes and lineage refs are first-class scorecard inputs; market freshness evidence is first-class for this audit sample |
| Workbook/reviewer defensibility | 10 | 9.5 | strong | Shared trust envelope is surfaced across core UI/report tabs; Audit CLI now emits family, strategy, status class, and taxonomy outcome for each row; Reviewer pack parity checkpoint now passes when source lineage, market freshness, parser fidelity, and independent valuation evidence are all present | — |
| Engineering/release quality | 10 | 8.5 | strong | Audit harness completed 33 rows with 0 CALC_ERROR outcomes; Repository exposes validate, release validation, golden tests, and all-company audit scripts | — |

## Audit Outcomes

- PRODUCTION_READY: 0
- VALUATION_ELIGIBLE_GUARDED: 0
- ECONOMICALLY_PLAUSIBLE_CAPPED: 0
- EXPECTED_SKIP_MISSING_SIDECAR: 0
- EXPECTED_SKIP_INSUFFICIENT_HISTORY: 0
- EXPECTED_SKIP_UNSUPPORTED_SOURCE: 0
- MODEL_GAP: 0
- POLICY_WARNING: 33
- CALC_ERROR: 0

Calculation errors: 0
Expected skips: 0
Actionable rows: 33

## Blocker Counts

- parser-fidelity: 2
- reconciliation: 53
- source-lineage: 0
- market-freshness: 0
- valuation-readiness: 14
- sector-contract: 11
- model-applicability: 33
- cross-lens-disagreement: 1
- reviewer-pack: 7

## Row Blocker Ledger

| Ticker | Outcome | Rigor | Readiness | Blockers |
|---|---|---|---|---|
| ASIANPAINT | POLICY_WARNING | syntactically-valid | warning | rigor-syntactic-only; reconciliation-not-cleared; valuation-readiness-warning; policy-warning-rigor-cap |
| DMART | POLICY_WARNING | syntactically-valid | guarded | rigor-syntactic-only; reconciliation-not-cleared; valuation-readiness-guarded; reviewer-pack-missing; policy-warning-rigor-cap |
| BAJFINANCE | POLICY_WARNING | structurally-reconciled | production-ready | policy-warning-rigor-cap |
| BHARTIARTL | POLICY_WARNING | syntactically-valid | guarded | rigor-syntactic-only; reconciliation-not-cleared; valuation-readiness-guarded; sector-native-strategy-missing; reviewer-pack-missing; policy-warning-rigor-cap |
| BRITANNIA | POLICY_WARNING | syntactically-valid | warning | rigor-syntactic-only; reconciliation-not-cleared; valuation-readiness-warning; policy-warning-rigor-cap |
| CHOLAFIN | POLICY_WARNING | syntactically-valid | production-ready | rigor-syntactic-only; reconciliation-not-cleared; policy-warning-rigor-cap |
| DABUR | POLICY_WARNING | syntactically-valid | production-ready | rigor-syntactic-only; reconciliation-not-cleared; policy-warning-rigor-cap |
| GRASIM | POLICY_WARNING | syntactically-valid | warning | rigor-syntactic-only; reconciliation-not-cleared; valuation-readiness-warning; policy-warning-rigor-cap |
| HDFCBANK | POLICY_WARNING | structurally-reconciled | production-ready | policy-warning-rigor-cap |
| HDFCLIFE | POLICY_WARNING | structurally-reconciled | production-ready | policy-warning-rigor-cap |
| HINDUNILVR | POLICY_WARNING | syntactically-valid | guarded | rigor-syntactic-only; reconciliation-not-cleared; policy-warning-rigor-cap |
| ICICIBANK | POLICY_WARNING | syntactically-valid | production-ready | parser-fidelity-not-cleared; rigor-syntactic-only; reviewer-pack-missing; policy-warning-rigor-cap |
| ITC | POLICY_WARNING | syntactically-valid | guarded | rigor-syntactic-only; reconciliation-not-cleared; sector-native-strategy-missing; policy-warning-rigor-cap |
| INFY | POLICY_WARNING | syntactically-valid | guarded | rigor-syntactic-only; reconciliation-not-cleared; policy-warning-rigor-cap |
| KOTAKBANK | POLICY_WARNING | structurally-reconciled | production-ready | policy-warning-rigor-cap |
| LICI | POLICY_WARNING | structurally-reconciled | production-ready | policy-warning-rigor-cap |
| LT | POLICY_WARNING | syntactically-valid | warning | rigor-syntactic-only; reconciliation-not-cleared; valuation-readiness-warning; sector-native-strategy-missing; policy-warning-rigor-cap |
| M&M | POLICY_WARNING | syntactically-valid | warning | rigor-syntactic-only; reconciliation-not-cleared; valuation-readiness-warning; sector-native-strategy-missing; reviewer-pack-missing; policy-warning-rigor-cap |
| MARUTI | POLICY_WARNING | syntactically-valid | warning | rigor-syntactic-only; reconciliation-not-cleared; valuation-readiness-warning; policy-warning-rigor-cap |
| MUTHOOTFIN | POLICY_WARNING | structurally-reconciled | production-ready | policy-warning-rigor-cap |
| NTPC | POLICY_WARNING | syntactically-valid | warning | rigor-syntactic-only; reconciliation-not-cleared; valuation-readiness-warning; sector-native-strategy-missing; policy-warning-rigor-cap |
| NESTLEIND | POLICY_WARNING | syntactically-valid | guarded | rigor-syntactic-only; reconciliation-not-cleared; policy-warning-rigor-cap |
| PAYTM | POLICY_WARNING | syntactically-valid | guarded | rigor-syntactic-only; reconciliation-not-cleared; valuation-readiness-guarded; sector-native-strategy-missing; single-valuation-spine; reviewer-pack-missing; policy-warning-rigor-cap |
| POWERGRID | POLICY_WARNING | syntactically-valid | production-ready | rigor-syntactic-only; reconciliation-not-cleared; sector-native-strategy-missing; policy-warning-rigor-cap |
| RELIANCE | POLICY_WARNING | syntactically-valid | guarded | parser-fidelity-not-cleared; rigor-syntactic-only; reconciliation-not-cleared; valuation-readiness-guarded; sector-native-strategy-missing; reviewer-pack-missing; policy-warning-rigor-cap |
| SHRIRAMFIN | POLICY_WARNING | syntactically-valid | production-ready | rigor-syntactic-only; reconciliation-not-cleared; policy-warning-rigor-cap |
| SBIN | POLICY_WARNING | syntactically-valid | production-ready | rigor-syntactic-only; reconciliation-not-cleared; policy-warning-rigor-cap |
| SUNPHARMA | POLICY_WARNING | syntactically-valid | production-ready | rigor-syntactic-only; reconciliation-not-cleared; policy-warning-rigor-cap |
| TCS | POLICY_WARNING | syntactically-valid | warning | rigor-syntactic-only; reconciliation-not-cleared; valuation-readiness-warning; policy-warning-rigor-cap |
| TATASTEEL | POLICY_WARNING | syntactically-valid | production-ready | rigor-syntactic-only; reconciliation-not-cleared; sector-native-strategy-missing; policy-warning-rigor-cap |
| TITAN | POLICY_WARNING | syntactically-valid | warning | rigor-syntactic-only; reconciliation-not-cleared; valuation-readiness-warning; policy-warning-rigor-cap |
| ULTRACEMCO | POLICY_WARNING | syntactically-valid | guarded | rigor-syntactic-only; reconciliation-not-cleared; sector-native-strategy-missing; policy-warning-rigor-cap |
| IDEA | POLICY_WARNING | syntactically-valid | guarded | rigor-syntactic-only; reconciliation-not-cleared; valuation-readiness-guarded; sector-native-strategy-missing; reviewer-pack-missing; policy-warning-rigor-cap |

## Production-Ready Checkpoints

| Ticker | Status | Failed / non-pass checkpoints |
|---|---|---|
| ASIANPAINT | blocked | reconciliation: Reconciliation is failed (max residual 159.9%).; valuation-readiness: Valuation readiness is warning. |
| DMART | blocked | reconciliation: Reconciliation is failed (max residual 193.0%).; valuation-readiness: Valuation readiness is guarded.; independent-evidence: At least two independent valuation evidence groups are required.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| BAJFINANCE | pass | — |
| BHARTIARTL | blocked | reconciliation: Reconciliation is failed (max residual 191.9%).; valuation-readiness: Valuation readiness is guarded.; independent-evidence: At least two independent valuation evidence groups are required.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| BRITANNIA | blocked | reconciliation: Reconciliation is failed (max residual 189.5%).; valuation-readiness: Valuation readiness is warning. |
| CHOLAFIN | blocked | reconciliation: Reconciliation is failed (max residual 100.0%). |
| DABUR | blocked | reconciliation: Reconciliation is failed (max residual 136.9%). |
| GRASIM | blocked | reconciliation: Reconciliation is failed (max residual 185.8%).; valuation-readiness: Valuation readiness is warning. |
| HDFCBANK | pass | — |
| HDFCLIFE | pass | — |
| HINDUNILVR | blocked | reconciliation: Reconciliation is failed (max residual 170.3%). |
| ICICIBANK | blocked | parser-fidelity: Parser fidelity is failed (55/100).; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| ITC | blocked | reconciliation: Reconciliation is failed (max residual 137.5%). |
| INFY | blocked | reconciliation: Reconciliation is failed (max residual 197.0%). |
| KOTAKBANK | pass | — |
| LICI | pass | — |
| LT | blocked | reconciliation: Reconciliation is failed (max residual 186.7%).; valuation-readiness: Valuation readiness is warning. |
| M&M | blocked | reconciliation: Reconciliation is failed (max residual 187.1%).; valuation-readiness: Valuation readiness is warning.; independent-evidence: At least two independent valuation evidence groups are required.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| MARUTI | blocked | reconciliation: Reconciliation is failed (max residual 195.0%).; valuation-readiness: Valuation readiness is warning. |
| MUTHOOTFIN | pass | — |
| NTPC | blocked | reconciliation: Reconciliation is failed (max residual 135.4%).; valuation-readiness: Valuation readiness is warning. |
| NESTLEIND | blocked | reconciliation: Reconciliation is failed (max residual 129.3%). |
| PAYTM | blocked | reconciliation: Reconciliation is failed (max residual 5293.7%).; valuation-readiness: Valuation readiness is guarded.; independent-evidence: At least two independent valuation evidence groups are required.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| POWERGRID | blocked | reconciliation: Reconciliation is failed (max residual 195.6%). |
| RELIANCE | blocked | parser-fidelity: Parser fidelity is failed (55/100).; reconciliation: Reconciliation is failed (max residual 166.0%).; valuation-readiness: Valuation readiness is guarded.; independent-evidence: At least two independent valuation evidence groups are required.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| SHRIRAMFIN | blocked | reconciliation: Reconciliation is failed (max residual 85.9%). |
| SBIN | blocked | reconciliation: Reconciliation is failed (max residual 111.3%). |
| SUNPHARMA | blocked | reconciliation: Reconciliation is failed (max residual 198.5%). |
| TCS | blocked | reconciliation: Reconciliation is failed (max residual 198.5%).; valuation-readiness: Valuation readiness is warning. |
| TATASTEEL | blocked | reconciliation: Reconciliation is failed (max residual 189.5%). |
| TITAN | blocked | reconciliation: Reconciliation is failed (max residual 193.7%).; valuation-readiness: Valuation readiness is warning. |
| ULTRACEMCO | blocked | reconciliation: Reconciliation is failed (max residual 181.7%). |
| IDEA | blocked | reconciliation: Reconciliation is failed (max residual 196.4%).; valuation-readiness: Valuation readiness is guarded.; independent-evidence: At least two independent valuation evidence groups are required.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |

## Company-Type Mix

- bank: 4
- conglomerate: 3
- consumer: 7
- cyclical: 3
- industrial: 3
- insurance: 2
- it-services: 2
- loss-maker: 1
- nbfc: 4
- telecom: 2
- utility: 2

