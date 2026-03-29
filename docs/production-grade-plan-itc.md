# ITC Production-Grade Plan

## Purpose

This document converts the current live findings from the audited ITC run into a concrete production plan for the Penman analysis app.

Scope:

- validate whether the current ITC output is trustworthy,
- identify where the business logic is strong or weak,
- identify mapping gaps and unused data,
- define the work needed to reach production-grade quality.

This plan is based on:

- the deployed Vercel run for ITC,
- the persisted input ZIP and generated workbook,
- direct inspection of the current parser, engine, report, audit, and export code.

Run used for evidence:

- `runId`: `243da112-8772-4c74-adda-b132017600c8`
- company: `ITC`
- source: `capitaline`
- input ZIP: `financiall data.zip`
- periods parsed: `15`
- latest period: `2025-03-31`

## Executive Assessment

### Bottom line

The app is not yet fully production-grade for decision-quality financial analysis.

It is already strong in these areas:

- ingestion of Capitaline ZIP input is working,
- period extraction and statement parsing are working,
- canonical recast statements and ratios are being produced consistently,
- provenance and audit capture are in place,
- the ITC run completed without parser failure or hard mapping failure.

It is not yet strong enough in these areas:

- it can still produce valuation output from a contaminated latest period,
- provenance discrepancy reporting is noisy and overstates some mapping issues,
- a large amount of parsed source detail does not flow into the core operating model,
- export/report presentation does not always preserve company identity and model confidence clearly enough,
- there is not yet a company-grounded acceptance framework that proves the economics are correct across real issuers.

### Is the ITC output right?

Short answer: partially, but not enough to treat the valuation as fully reliable.

What appears right:

- the input was parsed correctly across `15` annual periods,
- key statements and major lines were mapped,
- the model generated internally coherent recast statements and ratios,
- the latest run reached analysis-ready state and generated an XLSX artifact successfully.

What appears not yet safe:

- the latest ITC period contains abnormal items that materially affect terminal-period valuation,
- the app still computes valuation without a hard confidence gate,
- the provenance workbook currently mixes real issues with harmless missing aliases,
- many source metrics that could improve operating decomposition are still unused.

Conclusion:

- use the current output as an analytical draft,
- do not treat the current valuation and confidence presentation as production-safe final output.

## Observed Evidence From The ITC Run

### What was ingested

The persisted ZIP contains:

- `BalanceSheetINDAS_.xls`
- `CashFlow_.xls`
- `ProfitLossINDAS_.xls`

Observed parser output:

- `15` periods from `2011-03-31` to `2025-03-31`
- `1,593` unique base metrics
- `24,615` composite key entries across statements and periods
- dataset key counts:
  - `BalanceSheet`: `922`
  - `ProfitLoss`: `644`
  - `CashFlow`: `75`
- parser warnings: none

### What the engine produced

For the latest period `2025-03-31`, the live inspection showed:

- `Sales`: `75,323.34`
- `CNI`: `34,427.62`
- `OI`: `33,047.50`
- `UOI`: `15,668.43`
- `ExceptionalItemsAfterTax`: `16,293.29`
- `dirty_surplus`: `-21,122.35`

The latest period also carried critical structural flags affecting terminal interpretation, including:

- `STRUCTURAL_EVENT`
- `CAPITAL_TRANSACTION_LIKELY`
- `PM_OUTLIER_CRITICAL`
- `ROCE_OUTLIER_CRITICAL`
- `RNOA_OUTLIER_CRITICAL`
- `INCREMENTAL_MARGIN_ANOMALY`
- `LARGE_PPE_DECLINE`

### What this means

The app is detecting that the latest period is abnormal. That is good.

The app is still letting that same period drive valuation output. That is not good enough for production.

## Current Strengths

### 1. Real input ingestion is working

The live ITC run proves that the app can:

- accept a Capitaline ZIP,
- parse real financial statement files,
- produce a multi-sheet workbook,
- persist audit snapshots and artifacts,
- expose run data for inspection.

This is materially better than a prototype that only works on mock JSON.

### 2. Core canonicalization is directionally sound

The current engine correctly focuses on:

- separating operating vs financial balance sheet items,
- reformulating income into `OI`, `NFE`, `CNI`, `CoreOI`, and `UOI`,
- decomposing Nissim and Penman style ratios,
- building forecast and valuation outputs from recast statements.

That architecture is a valid production foundation.

### 3. The mapping spec is broader than a minimal implementation

The spec already covers:

- major balance sheet classification,
- sales, PAT, PBT, tax, OCI, TCI,
- finance cost and finance income alternatives,
- exceptional and discontinued items,
- cash flow lines for CFO, capex, dividends, debt, and investment flows,
- several SG&A and retained earnings proxies.

This means the problem is not absence of mapping effort. The problem is incomplete use of that mapping inside the business model.

### 4. Auditability exists

The app now has:

- input persistence,
- event persistence,
- analysis snapshots,
- artifact persistence,
- run timeline inspection,
- automated monitor scaffolding.

That is essential for a finance product. It makes model defects diagnosable.

## Production Gaps

## P0: Trust And Valuation Gating

### Gap 1. Valuation is produced even when the terminal period is contaminated

Observed issue:

- the ITC latest period contains major unusual and structural signals,
- those signals are already computed,
- the UI still runs valuation unconditionally.

Business risk:

- a user sees a clean valuation number even when the terminal anchor is not economically representative,
- this creates false precision,
- the most dangerous output is not a crash; it is a persuasive but weak number.

Required change:

- add a valuation eligibility gate after anomaly detection and before report/export valuation rendering,
- when the latest period has critical `affects_terminal` flags, do one of:
  - block valuation completely,
  - force fallback to a prior clean anchor period,
  - or show valuation only under an explicit degraded-confidence mode.

Production standard:

- the app must not silently compute terminal value from a period it already knows is structurally abnormal.

### Gap 2. Provenance discrepancy reporting is overstating mapping failures

Observed issue:

- the current trace logic records `unmatched` for every missing synonym inside a key group,
- the discrepancy sheet then exports those entries as mapping failures,
- this makes successful mappings look partially broken.

Business risk:

- analysts and developers lose trust in the mapping audit,
- true failures get buried under alias noise,
- mapping quality appears worse than it is.

Required change:

- treat alias groups as resolution groups, not independent failures,
- record:
  - `resolved_primary`,
  - `resolved_alias`,
  - `unresolved_group`,
  - `duplicate_source_ignored`,
  - `fuzzy_match`,
- only emit a discrepancy when the whole required group fails or when fuzzy/duplicate handling needs review.

Production standard:

- discrepancy output must represent real unresolved business meaning, not harmless unmatched synonyms.

### Gap 3. Confidence is not yet first-class in the exported deliverable

Observed issue:

- the workbook shows full valuation sheets even when latest-period diagnostics are severe,
- the export does not elevate the distinction between valid recast output and low-confidence valuation output clearly enough.

Business risk:

- exported files can travel without the UI context that warned the analyst,
- downstream users may over-trust the workbook.

Required change:

- add explicit valuation status on cover and valuation sheets:
  - `production-ready`,
  - `warning`,
  - `blocked`,
- include the reasons,
- include anchor period used,
- include latest clean period if fallback logic is applied.

## P1: Business Logic Completeness

### Gap 4. Too much parsed source detail is unused in the core economic model

Observed issue from the ITC run:

- `1,445` source metrics are outside spec,
- `61` in-spec metrics present in the dataset were still unused,
- examples include:
  - employee cost,
  - other expenses,
  - depreciation variants,
  - detailed interest sub-lines,
  - legal/professional/advertising/rent/freight/repairs/power buckets,
  - revenue variants,
  - retained earnings proxies,
  - discontinued operations aliases.

Business risk:

- the app parses economically meaningful data but leaves value on the table,
- quality scoring and forecasts are less explainable than they could be,
- operating margin decomposition is less robust than the source data allows.

Required change:

- promote detailed opex buckets into the core model,
- produce a full operating cost bridge:
  - revenue,
  - material cost,
  - employee cost,
  - depreciation,
  - SG&A buckets,
  - other operating expenses,
  - other income and non-operating adjustments,
- use those drivers in forecast assumptions and anomaly interpretation.

Production standard:

- if source detail exists and is relevant to operating performance, it should either drive the model or be explicitly marked as unused by design.

### Gap 5. Exceptional, discontinued, OCI, and capital-transaction handling needs a stricter policy layer

Observed issue:

- the engine already computes `ExceptionalItemsAfterTax`, `UOI`, `OCI`, and dirty surplus signals,
- but the final presentation logic does not fully separate:
  - transitory operating noise,
  - capital transactions,
  - accounting restatements,
  - discontinued operations,
  - non-recurring strategic events.

Business risk:

- unusual items can pollute both valuation and quality interpretation,
- one-off structural events may be mistaken for persistent economics.

Required change:

- define a formal classification policy for non-recurring items,
- make every unusual component land in one of a small number of explicit buckets,
- decide which buckets:
  - affect `CoreOI`,
  - affect `UOI`,
  - block terminal valuation,
  - remain only as diagnostics.

Production standard:

- unusual-item treatment must be policy-driven and explainable, not just arithmetic.

### Gap 6. Company identity and issuer context are not propagated cleanly enough

Observed issue:

- the ITC workbook cover showed `Company = —`.

Business risk:

- exported workbooks lose provenance,
- multi-company workflows become harder to trust,
- audit trails become less human-readable.

Required change:

- propagate company identifier from ingestion through analysis state into export,
- persist at least:
  - company name,
  - ticker if known,
  - source system,
  - run ID,
  - analysis version,
  - mapping spec version.

Production standard:

- every exported artifact must be self-identifying.

## P2: Mapping Strategy And Coverage

### Gap 7. The mapping layer needs explicit coverage tiers

Current state:

- the mapping spec mixes core lines, aliases, and optional detail lines.

Problem:

- not all mapped keys are equally important,
- current reporting does not clearly separate:
  - valuation-critical lines,
  - ratio-critical lines,
  - quality-only lines,
  - optional diagnostic detail.

Required change:

- assign every mapping group a tier:
  - `Tier A`: valuation-critical,
  - `Tier B`: ratio-critical,
  - `Tier C`: quality/diagnostic,
  - `Tier D`: optional detail.

Then use those tiers to drive:

- gating,
- audit reports,
- missing-data severity,
- test coverage priority,
- monitor alert severity.

### Gap 8. Statement-specific key ownership is still too permissive

Current risk:

- the parser keeps base-key fallback compatibility,
- where the same label exists across statements, a fallback can still hide statement ownership ambiguity if not carefully guarded.

Required change:

- make statement-qualified keys the primary source everywhere in engine logic,
- reserve base-key fallback for compatibility and diagnostics only,
- surface any cross-statement collision explicitly in trace output.

Production standard:

- every economically important number should be traceable to the originating statement and line.

### Gap 9. Dataset-not-in-spec analysis is not yet driving roadmap decisions

Observed issue:

- the ITC dataset includes many lines outside the current spec,
- there is no clear prioritization process to decide which should enter the spec next.

Required change:

- generate a frequency-ranked backlog from audited real runs,
- rank candidate additions by:
  - frequency across companies,
  - impact on `OI`, `NOA`, `NFE`, tax, or valuation,
  - usefulness for forecast drivers,
  - usefulness for data-quality interpretation.

Production standard:

- mapping growth should be evidence-driven, not ad hoc.

## P3: Verification And Release Discipline

### Gap 10. There is not yet a company-backed golden dataset suite

Current state:

- unit tests and regression tests exist,
- but production confidence still depends too much on generic cases and developer reasoning.

Required change:

- create a golden-company test suite with real audited runs,
- start with:
  - ITC,
  - one leveraged industrial,
  - one bank or financial excluded case for validation of unsupported scope,
  - one consumer company with clean steady economics,
  - one company with heavy exceptional items.

For each company store:

- expected mapping coverage,
- expected gating status,
- expected ratio ranges,
- expected anomaly flags,
- expected valuation eligibility,
- expected export metadata.

Production standard:

- a code change should not ship unless the golden-company suite passes.

### Gap 11. There is no formal output acceptance rubric

The app needs an explicit answer to: what does “right” mean?

Required rubric:

- parser correctness:
  - periods, statements, sign conventions, no dropped files
- mapping correctness:
  - canonical variables resolve to the intended source lines
- accounting identity correctness:
  - core identity assertions pass
- economic plausibility:
  - ratios and driver behavior are within reasonable ranges or clearly flagged
- valuation eligibility:
  - only allowed when terminal anchor is clean enough
- explainability:
  - every material output line is traceable
- export integrity:
  - workbook/report labels, company identity, dates, and confidence state are correct

### Gap 12. Versioning of model behavior is not explicit enough in artifacts

Required change:

- include in snapshot and export:
  - engine version,
  - mapping spec version,
  - anomaly policy version,
  - valuation policy version.

Production standard:

- every number must be attributable to a specific versioned logic stack.

## Plan Of Record

## Phase 1: Trustworthy Output

Goal:

- stop unsafe valuation output,
- clean up the audit signal,
- make the export honest about confidence.

Changes:

1. Add terminal-period valuation gate.
2. Add fallback-to-prior-clean-period logic.
3. Refactor provenance discrepancy logic from alias-level to group-level resolution.
4. Show valuation status and reasons in UI and workbook.
5. Pass company identity into export.

Exit criteria:

- ITC latest period is either blocked or anchored to a prior clean period,
- mapping discrepancy sheet no longer lists harmless alias misses as failures,
- cover sheet identifies ITC correctly,
- exported workbook clearly shows confidence and anchor policy.

## Phase 2: Complete The Economic Model

Goal:

- use more of the uploaded data in economically meaningful ways.

Changes:

1. Build a cost bridge from detailed P&L lines.
2. Expand forecast drivers to use employee, SG&A, depreciation, and other opex structure.
3. Formalize unusual-item taxonomy and policy.
4. Improve retained earnings and dirty-surplus diagnostics.
5. Add line-level attribution showing which raw metrics drive `CoreOI`, `UOI`, `NFE`, `NOA`, and forecast anchors.

Exit criteria:

- in-spec unused metrics are intentionally reduced,
- ITC and similar companies show richer operating decomposition,
- unusual items are classified consistently and auditable.

## Phase 3: Evidence-Driven Mapping Expansion

Goal:

- grow the mapping spec based on actual observed company data.

Changes:

1. Mine audited runs for frequently occurring out-of-spec labels.
2. Rank candidate labels by business impact.
3. Add coverage tiers and severity rules.
4. Add explicit collision diagnostics and statement-ownership tests.

Exit criteria:

- top recurring out-of-spec labels are triaged,
- mapping additions are prioritized by impact, not convenience,
- audit reports distinguish critical misses from optional detail misses.

## Phase 4: Production Release Discipline

Goal:

- make future changes safe.

Changes:

1. Create golden-company fixtures and expectations.
2. Add company-specific regression snapshots.
3. Add release checks for valuation eligibility, anomaly policy, and export metadata.
4. Make monitor alerts severity-aware based on mapping tiers and valuation gates.

Exit criteria:

- every release runs golden-company validation,
- valuation logic changes require updated expectations,
- monitor reports are useful for real production triage.

## Recommended Immediate Backlog

### Highest priority

1. Block or downgrade valuation when terminal-period anomaly flags are critical.
2. Fix mapping discrepancy generation so only unresolved groups are shown as missing.
3. Fix export metadata so company identity is always present.

### Next priority

4. Implement detailed operating-cost bridge and use it in forecasts.
5. Formalize unusual-item and capital-transaction policy.
6. Add company-backed acceptance tests starting with ITC.

### Then

7. Add mapping coverage tiers.
8. Build ranked out-of-spec label backlog from live audited runs.
9. Version engine, mapping, and policy metadata in artifacts and snapshots.

## ITC-Specific Interpretation

### What appears mapped well enough already

- core revenue,
- tax,
- PBT and PAT,
- OCI and TCI framework,
- finance cost,
- finance income fallbacks,
- exceptional and discontinued paths,
- operating vs financial balance sheet recast.

### What appears underused for ITC

- employee cost,
- other expenses,
- depreciation variants,
- detailed interest cost components,
- advertising,
- legal and professional fees,
- rent,
- freight,
- repairs,
- power and fuel,
- retained earnings proxy lines,
- some revenue aliases already present in spec but not always used in the best explanatory way.

### Practical conclusion for ITC

The app understands the ITC statements well enough to build a serious draft analysis. It does not yet use the full richness of the source data, and it is not yet disciplined enough to stop an abnormal latest period from feeding a polished valuation output.

## Acceptance Criteria For “Production Grade”

The app should only be called production-grade when all of the following are true:

- real-company runs parse cleanly and reproducibly,
- valuation output is blocked or downgraded when terminal anchors are contaminated,
- discrepancy reports represent real business meaning, not alias noise,
- every exported artifact is self-identifying and versioned,
- important in-spec metrics are either used in the model or explicitly marked optional,
- golden-company regression tests pass,
- monitor alerts map to true severity,
- an analyst can explain every material output number back to source lines and policy rules.

## Recommended Next Implementation Sequence

1. Fix valuation gating and export confidence.
2. Fix provenance discrepancy semantics.
3. Fix company identity propagation in exports.
4. Build ITC golden-company regression expectations.
5. Expand operating decomposition and forecast driver usage.
6. Add coverage tiers and ranked mapping backlog automation.

## Final Recommendation

Do not position the current app as fully production-grade valuation software yet.

Position it as:

- strong audited financial-ingestion and recast engine,
- promising Penman analysis platform,
- already useful for analyst workflow,
- not yet safe for fully trusted valuation outputs without the gating, policy, and acceptance work defined above.

If the goal is institutional-grade output, Phase 1 and Phase 4 are mandatory, not optional.
