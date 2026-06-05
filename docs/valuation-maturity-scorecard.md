# Valuation Maturity Scorecard

Generated: 2026-06-05T18:57:41.904Z
Schema: `2026-06-valuation-maturity-v2`
Overall score: **8.5/10** (reviewer-ready)
Audited corpus: 33 companies; total weight 100

## Current Baseline and Target

- Current score: **8.5/10**.
- Current rating: `reviewer-ready`.
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
| Industrial core valuation | 15 | 7.9 | guarded | 12/33 audited rows are core industrial/consumer/IT-services; Outcomes: POLICY_WARNING, ECONOMICALLY_PLAUSIBLE_CAPPED | 9 core rows still carry policy/model/calculation blockers |
| Bank/NBFC/insurance coverage | 15 | 8.0 | guarded | 10/33 audited rows are banks, NBFCs, or insurers; Contributing model counts: 5, 4, 3 | — |
| Sector-native coverage | 12 | 7.7 | guarded | 11/33 audited rows need sector-native economics; Sector types: telecom, conglomerate, cyclical, utility +1 more | — |
| Cross-paradigm independence | 12 | 9.5 | strong | 33 audited rows assessed for contributing valuation lenses; Model sets: VCC+SOTP+EPV+CASH_DCF+EWS, VCC+EPV+CASH_DCF+EWS, PB+ERI+DDM+P/AUM+ROA×LevRI, VCC+SOTP+EPV+CASH_DCF+EWS+TELECOM_NATIVE +10 more; Triangulation methods: accrual-riv, cash-fcff-dcf, relative-ev-ebitda, bank-pb +9 more; Independent lens groups: accrual-history, cash-statement, book-value, residual-income +2 more | — |
| Traceability/reconciliation/fail-closed gates | 16 | 7.7 | guarded | Rigor levels: structurally-reconciled, economically-plausible, syntactically-valid; Valuation readiness statuses: guarded, production-ready, warning; 0/33 audited rows reached production-ready rigor | 2 rows remain at syntactically-valid rigor; No audited row currently clears the production-ready gate |
| Data freshness/source tieout | 10 | 10.0 | strong | 33/33 audited rows have parsed periods; 33/33 audited rows expose latest period labels | 10 rows lack first-class source lineage evidence; 1 row lacks fresh timestamped market evidence; source hashes/source-cell lineage remain incomplete for the rows above; market freshness remains blocked where source_unavailable/stale evidence is emitted |
| Workbook/reviewer defensibility | 10 | 9.5 | strong | Shared trust envelope is surfaced across core UI/report tabs; Audit CLI now emits family, strategy, status class, and taxonomy outcome for each row; Reviewer pack parity checkpoint now passes when source lineage, market freshness, parser fidelity, and independent valuation evidence are all present | — |
| Engineering/release quality | 10 | 8.5 | strong | Audit harness completed 33 rows with 0 CALC_ERROR outcomes; Repository exposes validate, release validation, golden tests, and all-company audit scripts | — |

## Audit Outcomes

- PRODUCTION_READY: 0
- VALUATION_ELIGIBLE_GUARDED: 0
- ECONOMICALLY_PLAUSIBLE_CAPPED: 9
- EXPECTED_SKIP_MISSING_SIDECAR: 0
- EXPECTED_SKIP_INSUFFICIENT_HISTORY: 0
- EXPECTED_SKIP_UNSUPPORTED_SOURCE: 0
- MODEL_GAP: 0
- POLICY_WARNING: 24
- CALC_ERROR: 0

Calculation errors: 0
Expected skips: 0
Actionable rows: 24

## Blocker Counts

- parser-fidelity: 0
- reconciliation: 4
- source-lineage: 10
- market-freshness: 1
- valuation-readiness: 6
- sector-contract: 0
- model-applicability: 24
- cross-lens-disagreement: 0
- reviewer-pack: 11

## Row Blocker Ledger

| Ticker | Outcome | Rigor | Readiness | Blockers |
|---|---|---|---|---|
| ASIANPAINT | POLICY_WARNING | structurally-reconciled | guarded | policy-warning-unexplained |
| DMART | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | guarded | — |
| BAJFINANCE | POLICY_WARNING | structurally-reconciled | production-ready | source-lineage-missing; reviewer-pack-missing; policy-warning-unexplained |
| BHARTIARTL | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | guarded | — |
| BRITANNIA | POLICY_WARNING | structurally-reconciled | guarded | policy-warning-unexplained |
| CHOLAFIN | POLICY_WARNING | structurally-reconciled | production-ready | source-lineage-missing; reviewer-pack-missing; policy-warning-unexplained |
| DABUR | POLICY_WARNING | syntactically-valid | warning | rigor-syntactic-only; reconciliation-not-cleared; valuation-readiness-warning; policy-warning-unexplained |
| GRASIM | POLICY_WARNING | structurally-reconciled | warning | valuation-readiness-warning; reviewer-pack-missing; policy-warning-unexplained |
| HDFCBANK | POLICY_WARNING | structurally-reconciled | production-ready | source-lineage-missing; reviewer-pack-missing; policy-warning-unexplained |
| HDFCLIFE | POLICY_WARNING | structurally-reconciled | production-ready | source-lineage-missing; reviewer-pack-missing; policy-warning-unexplained |
| HINDUNILVR | POLICY_WARNING | structurally-reconciled | guarded | policy-warning-unexplained |
| ICICIBANK | POLICY_WARNING | structurally-reconciled | production-ready | source-lineage-missing; reviewer-pack-missing; policy-warning-unexplained |
| ITC | POLICY_WARNING | structurally-reconciled | guarded | policy-warning-unexplained |
| INFY | POLICY_WARNING | structurally-reconciled | guarded | policy-warning-unexplained |
| KOTAKBANK | POLICY_WARNING | structurally-reconciled | production-ready | source-lineage-missing; reviewer-pack-missing; policy-warning-unexplained |
| LICI | POLICY_WARNING | structurally-reconciled | production-ready | source-lineage-missing; reviewer-pack-missing; policy-warning-unexplained |
| LT | POLICY_WARNING | structurally-reconciled | guarded | policy-warning-unexplained |
| M&M | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | guarded | — |
| MARUTI | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | warning | valuation-readiness-warning |
| MUTHOOTFIN | POLICY_WARNING | structurally-reconciled | production-ready | source-lineage-missing; reviewer-pack-missing; policy-warning-unexplained |
| NTPC | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | warning | valuation-readiness-warning |
| NESTLEIND | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | guarded | — |
| PAYTM | POLICY_WARNING | structurally-reconciled | guarded | policy-warning-unexplained |
| POWERGRID | POLICY_WARNING | structurally-reconciled | warning | valuation-readiness-warning; policy-warning-unexplained |
| RELIANCE | POLICY_WARNING | structurally-reconciled | guarded | policy-warning-unexplained |
| SHRIRAMFINAN | POLICY_WARNING | structurally-reconciled | production-ready | source-lineage-missing; market-freshness-source-unavailable; reviewer-pack-missing; policy-warning-unexplained |
| SBIN | POLICY_WARNING | syntactically-valid | production-ready | rigor-syntactic-only; reconciliation-not-cleared; source-lineage-missing; reviewer-pack-missing; policy-warning-unexplained |
| SUNPHARMA | POLICY_WARNING | structurally-reconciled | warning | valuation-readiness-warning; policy-warning-unexplained |
| TCS | POLICY_WARNING | structurally-reconciled | guarded | policy-warning-unexplained |
| TATASTEEL | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | production-ready | — |
| TITAN | POLICY_WARNING | structurally-reconciled | guarded | policy-warning-unexplained |
| ULTRACEMCO | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | guarded | — |
| IDEA | ECONOMICALLY_PLAUSIBLE_CAPPED | economically-plausible | guarded | — |

## Production-Ready Checkpoints

| Ticker | Status | Failed / non-pass checkpoints |
|---|---|---|
| ASIANPAINT | pass | — |
| DMART | pass | — |
| BAJFINANCE | blocked | source-lineage: Source artifact hash and bounded lineageRef evidence are incomplete.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| BHARTIARTL | blocked | reconciliation: Reconciliation is degraded (max residual 178.6%). |
| BRITANNIA | pass | — |
| CHOLAFIN | blocked | source-lineage: Source artifact hash and bounded lineageRef evidence are incomplete.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| DABUR | blocked | reconciliation: Reconciliation is failed (max residual 100.0%).; valuation-readiness: Valuation readiness is warning. |
| GRASIM | blocked | reconciliation: Reconciliation is degraded (max residual 141.6%).; valuation-readiness: Valuation readiness is warning.; independent-evidence: At least two independent valuation evidence groups are required.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| HDFCBANK | blocked | source-lineage: Source artifact hash and bounded lineageRef evidence are incomplete.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| HDFCLIFE | blocked | source-lineage: Source artifact hash and bounded lineageRef evidence are incomplete.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| HINDUNILVR | pass | — |
| ICICIBANK | blocked | source-lineage: Source artifact hash and bounded lineageRef evidence are incomplete.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| ITC | pass | — |
| INFY | pass | — |
| KOTAKBANK | blocked | source-lineage: Source artifact hash and bounded lineageRef evidence are incomplete.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| LICI | blocked | source-lineage: Source artifact hash and bounded lineageRef evidence are incomplete.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| LT | pass | — |
| M&M | blocked | reconciliation: Reconciliation is degraded (max residual 107.0%). |
| MARUTI | blocked | valuation-readiness: Valuation readiness is warning. |
| MUTHOOTFIN | blocked | source-lineage: Source artifact hash and bounded lineageRef evidence are incomplete.; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| NTPC | blocked | reconciliation: Reconciliation is degraded (max residual 150.3%).; valuation-readiness: Valuation readiness is warning. |
| NESTLEIND | pass | — |
| PAYTM | pass | — |
| POWERGRID | blocked | reconciliation: Reconciliation is degraded (max residual 139.2%).; valuation-readiness: Valuation readiness is warning. |
| RELIANCE | blocked | reconciliation: Reconciliation is degraded (max residual 125.6%). |
| SHRIRAMFINAN | blocked | source-lineage: Source artifact hash and bounded lineageRef evidence are incomplete.; market-freshness: Yahoo Finance returned 404; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| SBIN | blocked | source-lineage: Source artifact hash and bounded lineageRef evidence are incomplete.; reconciliation: Reconciliation is failed (max residual 111.3%).; reviewer-pack: Workbook/reviewer-pack parity evidence is incomplete: missing some of source lineage, market freshness, parser fidelity, or independent valuation evidence. |
| SUNPHARMA | blocked | valuation-readiness: Valuation readiness is warning. |
| TCS | pass | — |
| TATASTEEL | blocked | reconciliation: Reconciliation is degraded (max residual 165.4%). |
| TITAN | blocked | reconciliation: Reconciliation is degraded (max residual 197.3%). |
| ULTRACEMCO | pass | — |
| IDEA | pass | — |

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

