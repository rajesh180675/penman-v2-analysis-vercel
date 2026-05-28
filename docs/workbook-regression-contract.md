# Workbook Regression Contract

**Schema:** `2026-05-workbook-regression-contract-v1`
**Owner:** Penman V2 Analysis team
**Last reviewed:** 2026-05-28 (Plan v4 PR-E)

## Why this document exists

The XLSX workbook produced by `generateValuationWorkbook` is the auditor-facing artifact. Schema drift between the in-memory `AnalysisTraceabilityEnvelope` and the workbook produces silent audit corruption: values disagree with their on-screen presentation, and reviewers can no longer treat the workbook as evidence.

This contract pins:
1. The **sheet manifest** — which sheets must always be present.
2. The **labeled-cell contract** — which `(sheet, label)` cells must carry which envelope-derived value.
3. The **change procedure** — how to add or rename a sheet without breaking auditors.

## Required sheet manifest

Every workbook produced for a non-screening, non-blocked run MUST contain at least these sheets:

| Sheet name | Purpose |
|---|---|
| `Cover` | Company, run, generation timestamp, rigor level, capital costs. |
| `Recast Statements` | Period-by-period BS / IS / CF reconstruction. |
| `N&P Ratios` | Penman-Nissim ratios (RNOA, OLLEV, NBC, etc). |
| `Valuation` | Run-level valuation outputs and bridge to anchor period. |
| `Quality Scores` | Piotroski / Beneish / Altman / Zmijewski / Ohlson / Sloan. |
| `Traceability` | Direct mirror of `AnalysisTraceabilityEnvelope` shape. |
| `Ratio Sanity` | Sector cross-checks. |

Conditionally present:

| Sheet name | When present |
|---|---|
| `Forecast Model` | When `forecastScenarios.length > 0` |
| `Provenance Audit` | When at least one period has provenance rows |
| `Mapping Discrepancies` | When mapping discrepancies were detected |

A renamed or removed sheet from the required list MUST update both this document and `src/engine/__tests__/excelExport.spec.ts` REQUIRED_SHEETS in the same PR.

## Labeled-cell contract

For every cell exported via `(label in column A, value in column B)`, the value MUST match the corresponding field in the in-memory `AnalysisTraceabilityEnvelope`, `ValuationResult`, or `WorkbookExportMetadata` passed to `generateValuationWorkbook`. The current set of pinned cells:

### Cover sheet
| Label | Source | Type |
|---|---|---|
| `Cost of Equity (ke)` | `valuation.ke` | number |
| `Audit Run ID` | `metadata.auditRunId` | string |
| `Valuation Status` | `metadata.valuationStatus` | string |
| `Valuation Anchor Period` | `metadata.valuationAnchorPeriod` | string |
| `Engine Version` | `metadata.policyVersions.engineVersion` | string |
| `Mapping Spec Version` | `metadata.policyVersions.mappingSpecVersion` | string |
| `Scope Policy Version` | `metadata.policyVersions.scopePolicyVersion` | string |
| `Traceability Schema` | `metadata.policyVersions.traceabilitySchemaVersion` | string |
| `Rigor Level` | `traceability.rigor.currentLabel` | string |
| `Parser Fidelity` | `traceability.parserFidelity.status` | string |
| `Reconciliation Status` | `traceability.reconciliation.status` | string |

### Traceability sheet
| Label | Source | Type |
|---|---|---|
| `Run ID` | `traceability.runContext.runId` | string |
| `Schema Version` | `traceability.schemaVersion` | string |
| `Rigor Level` | `traceability.rigor.currentLabel` | string |
| `Parser Fidelity Status` | `traceability.parserFidelity.status` | string |
| `Parser Fidelity Score` | `traceability.parserFidelity.score` | number |
| `Reconciliation Status` | `traceability.reconciliation.status` | string |
| `Max Reconciliation Residual` | `traceability.reconciliation.maxResidualRatio` | number |
| `Achieved Levels` | `traceability.rigor.achievedLevels.join(" \| ")` | string |
| `Confidence Blocking Issues` | `traceability.confidence.blockingCount` | number |
| `Confidence Diagnostic Issues` | `traceability.confidence.diagnosticCount` | number |
| `Confidence Optional Issues` | `traceability.confidence.optionalCount` | number |
| `Mapping Blocking Issues` | `traceability.mappingCoverage.unresolvedBySeverity.critical` | number |
| `Mapping Diagnostic Issues` | `traceability.mappingCoverage.unresolvedBySeverity.warning` | number |
| `Mapping Optional Issues` | `traceability.mappingCoverage.unresolvedBySeverity.info` | number |

### Valuation sheet
| Label | Source | Type |
|---|---|---|
| `Audit Run ID` | `metadata.auditRunId` | string |
| `Valuation Status` | `metadata.valuationStatus` | string |
| `Anchor Period` | `metadata.valuationAnchorPeriod` | string |
| `RE (CV3 — Gordon Growth)` | `valuation.V_RE_CV3` (or "" when guarded) | number / string |
| `Guarded mode` | guarded-mode disclaimer string when `metadata.valuationStatus === "guarded"` | string |

## Change procedure

### Adding a new sheet
1. Implement the new sheet in `src/engine/excelExport.ts`.
2. Add it to the **Required sheet manifest** table above (or to the conditional table if presence depends on data).
3. Add an assertion in `src/engine/__tests__/excelExport.spec.ts` to lock its presence.
4. If the sheet has labeled cells, add them to the **Labeled-cell contract** tables and write a `valueByLabel(...)` assertion per cell.
5. Submit the engine change + this doc + the tests in the same PR.

### Renaming a sheet
1. Rename the sheet name in `src/engine/excelExport.ts`.
2. Update the entry in the **Required sheet manifest** table.
3. Update the literal `REQUIRED_SHEETS` array in `src/engine/__tests__/excelExport.spec.ts`.
4. Submit all three in the same PR.

The reviewer's job is to refuse engine changes that don't update both the contract and the tests.

### Renaming a labeled cell
1. Rename in `src/engine/excelExport.ts`.
2. Update the row in the **Labeled-cell contract** table.
3. Update the matching `valueByLabel(...)` call in `excelExport.spec.ts`.
4. Same PR for all three.

## Future extensions (not yet contracted)

- **Provenance sheet (Gap 4 / PR-D follow-up):** when the lineage sidecar is exported into the workbook, add the 8 instrumented numbers + their source / transform / policy lines to a new `Provenance` sheet. Document in this file before shipping.
- **Diff workbook:** an opt-in mode that writes only the cells that changed since a prior run. Not in scope for v1 of the contract.
