# Valuation Maturity Scorecard

Generated: 2026-06-04T16:00:15.438Z
Schema: `2026-06-valuation-maturity-v1`
Overall score: **6.1/10** (developing)
Audited corpus: 33 companies; total weight 100

## Family Scores

| Family | Weight | Score | Status | Evidence | Blockers |
|---|---:|---:|---|---|---|
| Industrial core valuation | 15 | 7.0 | guarded | 12/33 audited rows are core industrial/consumer/IT-services; Outcomes: POLICY_WARNING | 12 core rows still carry policy/model/calculation blockers |
| Bank/NBFC/insurance coverage | 15 | 7.0 | guarded | 10/33 audited rows are banks, NBFCs, or insurers; Contributing model counts: 5, 4, 3 | — |
| Sector-native coverage | 12 | 4.0 | blocked | 11/33 audited rows need sector-native economics; Sector types: telecom, conglomerate, cyclical, utility +1 more | telecom remains routed through industrial-v1 instead of a sector-native model; conglomerate remains routed through industrial-v1 instead of a sector-native model; cyclical remains routed through industrial-v1 instead of a sector-native model; utility remains routed through industrial-v1 instead of a sector-native model; loss-maker remains routed through industrial-v1 instead of a sector-native model |
| Cross-paradigm independence | 12 | 5.2 | gap | 33 audited rows assessed for contributing valuation lenses; Model sets: VCC, PB+ERI+DDM+P/AUM+ROA×LevRI, PB+ERI+DDM+ROA×LevRI, PB+ERI+DDM +1 more | 23/33 audited rows still rely on a single valuation spine |
| Traceability/reconciliation/fail-closed gates | 16 | 4.8 | blocked | Rigor levels: syntactically-valid, structurally-reconciled; 0/33 audited rows reached production-ready rigor | 24 rows remain at syntactically-valid rigor; No audited row currently clears the production-ready gate |
| Data freshness/source tieout | 10 | 6.0 | gap | 33/33 audited rows have parsed periods; 33/33 audited rows expose latest period labels | source hashes, source-cell tieout, and market freshness are not yet first-class scorecard inputs |
| Workbook/reviewer defensibility | 10 | 6.5 | gap | Shared trust envelope is surfaced across core UI/report tabs; Audit CLI now emits family, strategy, status class, and taxonomy outcome for each row | workbook parity, reviewer pack, and print/export evidence are not yet part of the release gate |
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
