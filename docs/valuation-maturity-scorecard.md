# Valuation Maturity Scorecard

Generated: 2026-11-15T06:52:28.944Z
Schema: `2026-06-valuation-maturity-v2`
Overall score: **8.5/10** (reviewer-ready)
Audited corpus: 33 companies; total weight 100

## Current Baseline and Target

- Current score: **8.5/10**.
- Current rating: `reviewer-ready`.
- Target score: **10.0/10**.
- Target state: no supported company type is silently routed through the wrong valuation family; unsupported source or sidecar gaps are explicit expected skips, not crashes or green badges.
- Baseline artifact source: `npm run scorecard -- --format md` over the audited company registry.
- Machine-readable source: `npm run scorecard -- --format json`.

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
| Industrial core valuation | 15 | 9.3 | strong | 12/33 audited rows are core industrial/consumer/IT-services; Outcomes: PRODUCTION_READY, VALUATION_ELIGIBLE_GUARDED, ECONOMICALLY_PLAUSIBLE_CAPPED | — |
| Bank/NBFC/insurance coverage | 15 | 8.1 | guarded | 10/33 audited rows are banks, NBFCs, or insurers; Contributing model counts: 5, 4 | — |
| Sector-native coverage | 12 | 5.1 | gap | 11/33 audited rows need sector-native economics; Sector types: telecom, conglomerate, cyclical, utility +1 more | telecom remains routed through telecom-v1 instead of a sector-native model; conglomerate remains routed through industrial-v1 instead of a sector-native model; cyclical remains routed through cyclical-v1 instead of a sector-native model; loss-maker remains routed through loss-maker-v1 instead of a sector-native model |
| Cross-paradigm independence | 12 | 8.9 | strong | 33 audited rows assessed for contributing valuation lenses; Model sets: VCC+SOTP+EPV+CASH_DCF, VCC+EPV+CASH_DCF, PB+ERI+DDM+P/AUM+ROA×LevRI, PB+ERI+DDM+ROA×LevRI +3 more; Triangulation methods: accrual-riv, cash-fcff-dcf, bank-pb, bank-eri +5 more; Independent lens groups: accrual-history, cash-statement, fi-asset-market-multiple, fi-book-residual-income +2 more | 2/33 audited rows still rely on a single valuation spine; 2/33 audited rows lack triangulation/independence evidence |
| Traceability/reconciliation/fail-closed gates | 16 | 9.1 | strong | Rigor levels: production-ready, valuation-eligible, economically-plausible, structurally-reconciled; Valuation readiness statuses: production-ready, guarded, unknown, warning; 12/33 audited rows reached production-ready rigor | 2 rows lack valuation readiness evidence |
| Data freshness/source tieout | 10 | 10.0 | strong | 33/33 audited rows have parsed periods; 33/33 audited rows expose latest period labels; 33/33 audited rows carry hashed source lineage; 33/33 audited rows carry fresh timestamped market evidence | — |
| Workbook/reviewer defensibility | 10 | 9.5 | strong | Shared trust envelope is surfaced across core UI/report tabs; Audit CLI now emits family, strategy, status class, and taxonomy outcome for each row; Reviewer pack parity checkpoint now passes when source lineage, market freshness, parser fidelity, and independent valuation evidence are all present | — |
| Engineering/release quality | 10 | 8.5 | strong | Audit harness completed 33 rows with 0 CALC_ERROR outcomes; Repository exposes validate, release validation, golden tests, and all-company audit scripts | — |

## Audit Outcomes

- PRODUCTION_READY: 11
- VALUATION_ELIGIBLE_GUARDED: 6
- ECONOMICALLY_PLAUSIBLE_CAPPED: 9
- EXPECTED_SKIP_MISSING_SIDECAR: 0
- EXPECTED_SKIP_INSUFFICIENT_HISTORY: 0
- EXPECTED_SKIP_UNSUPPORTED_SOURCE: 0
- MODEL_GAP: 0
- POLICY_WARNING: 7
- CALC_ERROR: 0

Calculation errors: 0
Expected skips: 0
Actionable rows: 7

## Blocker Counts

- parser-fidelity: 0
- reconciliation: 0
- source-lineage: 0
- market-freshness: 0
- valuation-readiness: 4
- sector-contract: 8
- model-applicability: 4
- cross-lens-disagreement: 2
- reviewer-pack: 6

## Row Blocker Ledger

| Ticker | Outcome | Rigor | Readiness | Blockers |
|---|---|---|---|---|
| ASIANPAINT | PRODUCTION_READY | production-ready | production-ready | — |
| DMART | VALUATION_ELIGIBLE_GUARDED | valuation-eligible | production-ready | reviewer-pack-missing |
| BAJFINANCE | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | guarded | — |
| BHARTIARTL | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | production-ready | sector-native-strategy-missing |
| BRITANNIA | PRODUCTION_READY | production-ready | production-ready | — |
| CHOLAFIN | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | guarded | valuation-readiness-guarded; reviewer-pack-missing |
| DABUR | PRODUCTION_READY | production-ready | production-ready | — |
| GRASIM | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | production-ready | reviewer-pack-missing |
| HDFCBANK | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | guarded | — |
| HDFCLIFE | PRODUCTION_READY | production-ready | production-ready | — |
| HINDUNILVR | PRODUCTION_READY | production-ready | production-ready | — |
| ICICIBANK | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | guarded | — |
| ITC | PRODUCTION_READY | production-ready | production-ready | sector-native-strategy-missing |
| INFY | PRODUCTION_READY | production-ready | production-ready | — |
| KOTAKBANK | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | guarded | — |
| LICI | PRODUCTION_READY | production-ready | production-ready | — |
| LT | PRODUCTION_READY | production-ready | production-ready | sector-native-strategy-missing |
| M&M | POLICY_WARNING | production-ready | production-ready | sector-native-strategy-missing |
| MARUTI | VALUATION_ELIGIBLE_GUARDED | valuation-eligible | production-ready | — |
| MUTHOOTFIN | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | guarded | — |
| NTPC | POLICY_WARNING | valuation-eligible | production-ready | — |
| NESTLEIND | VALUATION_ELIGIBLE_GUARDED | valuation-eligible | production-ready | — |
| PAYTM | POLICY_WARNING | structurally-reconciled | unknown | valuation-readiness-unknown; sector-native-strategy-missing; model-gap; single-valuation-spine; reviewer-pack-missing; policy-warning-rigor-cap |
| POWERGRID | POLICY_WARNING | valuation-eligible | production-ready | — |
| RELIANCE | VALUATION_ELIGIBLE_GUARDED | valuation-eligible | production-ready | sector-native-strategy-missing; reviewer-pack-missing |
| SHRIRAMFIN | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | guarded | — |
| SBIN | VALUATION_ELIGIBLE_GUARDED | valuation-eligible | warning | valuation-readiness-warning |
| SUNPHARMA | PRODUCTION_READY | production-ready | production-ready | — |
| TCS | PRODUCTION_READY | production-ready | production-ready | — |
| TATASTEEL | POLICY_WARNING | valuation-eligible | production-ready | sector-native-strategy-missing |
| TITAN | VALUATION_ELIGIBLE_GUARDED | valuation-eligible | production-ready | — |
| ULTRACEMCO | POLICY_WARNING | valuation-eligible | production-ready | — |
| IDEA | POLICY_WARNING | structurally-reconciled | unknown | valuation-readiness-unknown; sector-native-strategy-missing; model-gap; single-valuation-spine; reviewer-pack-missing; policy-warning-rigor-cap |

## Production-Ready Checkpoints

| Ticker | Status | Failed / non-pass checkpoints |
|---|---|---|
| ASIANPAINT | pass | — |
| DMART | blocked | independent-evidence: At least two independent valuation evidence groups are required.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| BAJFINANCE | pass | — |
| BHARTIARTL | pass | — |
| BRITANNIA | pass | — |
| CHOLAFIN | blocked | valuation-readiness: Valuation readiness is guarded.; independent-evidence: At least two independent valuation evidence groups are required.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| DABUR | pass | — |
| GRASIM | blocked | independent-evidence: At least two independent valuation evidence groups are required.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| HDFCBANK | pass | — |
| HDFCLIFE | pass | — |
| HINDUNILVR | pass | — |
| ICICIBANK | pass | — |
| ITC | pass | — |
| INFY | pass | — |
| KOTAKBANK | pass | — |
| LICI | pass | — |
| LT | pass | — |
| M&M | pass | — |
| MARUTI | pass | — |
| MUTHOOTFIN | pass | — |
| NTPC | pass | — |
| NESTLEIND | pass | — |
| PAYTM | blocked | valuation-readiness: Valuation readiness is unknown.; independent-evidence: At least two independent valuation evidence groups are required.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| POWERGRID | pass | — |
| RELIANCE | blocked | independent-evidence: At least two independent valuation evidence groups are required.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| SHRIRAMFIN | pass | — |
| SBIN | blocked | valuation-readiness: Valuation readiness is warning. |
| SUNPHARMA | pass | — |
| TCS | pass | — |
| TATASTEEL | pass | — |
| TITAN | pass | — |
| ULTRACEMCO | pass | — |
| IDEA | blocked | valuation-readiness: Valuation readiness is unknown.; independent-evidence: At least two independent valuation evidence groups are required.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |

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

