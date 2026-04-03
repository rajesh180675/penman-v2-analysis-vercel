# Financial Model Rigor Plan

## Goal

Make the Penman V2 pipeline trustworthy enough that a skeptical reviewer can inspect one run, trace every material number to source, and see that weak or contaminated outputs are blocked instead of prettified.

## Current Assessment

The model already has real strengths: real audited runs, persisted input and artifact flow, a substantial accounting engine, and coherent major anchor numbers. The remaining trust gap is not "does it run?" but "can it prove that every material output is structurally sound, economically justified, and reproducible?"

The audit points to four core failure modes:

- raw input normalization is not strict enough
- concept identity is too noisy
- derived outputs are not reconciled aggressively enough
- exported and report surfaces still allow presentation drift from underlying confidence

## Plan

## 1. Lock Down the Input Contract

The first priority is to stop treating semi-normalized raw metrics as acceptable internal truth.

Do this:

- Define a strict persisted raw schema for one period:
  - `company_id`
  - `period_end`
  - `statement`
  - `metric_key_raw`
  - `metric_key_canonical`
  - `value`
  - `unit`
  - `source_file`
  - `source_row`
  - `source_col`
  - `parser_method`
  - `confidence`
- Stop persisting mixed scoped and unscoped keys in the main analytical object.
- Preserve original raw labels, but require canonical statement ownership before a metric becomes eligible for core analysis.
- Separate three layers explicitly:
  - uploaded source artifact
  - parsed raw extraction layer
  - normalized analytical layer

Exit criteria:

- zero mixed scoped and unscoped keys in normalized storage
- every persisted analytical metric has explicit statement ownership
- raw source remains available for forensic replay

## 2. Build a Canonical Concept Identity Layer

The audit shows concept duplication is a major trust leak. One concept must have one identity.

Do this:

- Introduce a canonical concept registry with:
  - `concept_id`
  - canonical label
  - allowed aliases
  - statement ownership
  - sign convention
  - aggregation behavior
  - valuation relevance
  - sector and provider relevance
- Normalize punctuation, casing, separators, and suffix noise before matching.
- Detect and quarantine collisions:
  - same normalized concept across multiple statements
  - same label mapping to different concepts
  - same concept represented by multiple raw labels in one filing
- Add explicit conflict classes:
  - `exact`
  - `alias`
  - `fuzzy-review`
  - `cross-statement-conflict`
  - `duplicate-source`
  - `unresolved`

Exit criteria:

- duplicate-concept groups are measurable and trend down over time
- unresolved valuation-critical concepts block valuation
- cross-statement collisions are surfaced, not silently absorbed

## 3. Add Parser Fidelity Checks Before Modeling

The pipeline should prove the uploaded files were parsed faithfully before any economics are trusted.

Do this:

- Add file-level checks for each uploaded statement file:
  - header detection quality
  - period extraction completeness
  - row count consistency across parse methods
  - numeric parse error count
  - blank and garbled row rate
- Add source-grid reconciliation:
  - sample important lines from parsed output and compare to source-sheet cell values
  - include latest-period direct tie-out for major lines
- Flag suspicious source artifacts:
  - HTML or xls junk fragments in parsed values
  - dash and zero ambiguity
  - repeated row labels with diverging values
  - period shifts or header drift

Exit criteria:

- parser emits a quality score per file
- parsing anomalies are visible in the audit snapshot
- poor parser fidelity blocks downstream clean status

## 4. Require Statement-Level Reconciliation Packs

Every run should automatically produce a reconciliation layer between raw statements and recast outputs.

Do this:

- For balance sheet:
  - tie `TA`, `Equity`, and `Total Liabilities`
  - tie `OA + FA = TA`
  - tie `CSE + MI + Liabilities = TA`
  - tie `NOA - NFO - CSE - MI ~= 0`
- For income statement:
  - tie `Revenue`, `PBT`, `Tax`, `PAT`, `OCI`, and `TCI`
  - reconcile `OI`, `Core OI`, `UOI`, `NFE`, and `CNI`
- For cash flow:
  - tie `CFO`, `capex`, `dividends`, debt and equity flows, and ending cash bridge
- For share data:
  - tie end-period shares, weighted average shares, share capital, face value, and dilution assumptions

Exit criteria:

- every material derived number has an upstream reconciliation table
- residuals are quantified and thresholded
- unreconciled material residuals block valuation-readiness

## 5. Add Economic Sanity Gates, Not Just Structural Gates

A file can parse correctly and still produce bad economics. The model must guard against that explicitly.

Do this:

- Add hard gates for:
  - terminal-period contamination
  - major capital transactions
  - dirty-surplus breaks
  - demergers and discontinued operations contaminating continuing economics
  - implausible incremental margins
  - implausible RNOA and ROCE jumps
- Distinguish:
  - structural anomaly
  - data-quality anomaly
  - economic anomaly
- Require fallback anchor logic:
  - choose prior clean period automatically when latest period is contaminated
- Show "why blocked" as first-class output

Exit criteria:

- model never presents clean valuation off a contaminated anchor
- fallback anchor period is explicit in workbook and UI
- contaminated runs can still be informative, but not clean

## 6. Formalize Unusual-Item and Capital-Transaction Policy

Right now the engine detects some of this, but to convince a skeptical reviewer the policy needs to be deterministic and inspectable.

Do this:

- Create an unusual-item taxonomy:
  - asset sale gains and losses
  - fair value changes
  - impairment
  - litigation
  - restructuring
  - demerger and scheme effects
  - one-time tax items
  - discontinued operations
  - buyback, special dividend, and capital return
- For each category define:
  - classification rules
  - whether it affects `Core OI`
  - whether it affects terminal value eligibility
  - whether it affects clean-surplus interpretation
- Add run-level manifests:
  - unusual-item summary
  - capital-transaction summary
  - terminal-anchor decision summary

Exit criteria:

- every major non-core item is classified or explicitly unresolved
- the effect on valuation status is deterministic
- auditors can inspect classification rationale line by line

## 7. Make Confidence Explicit and Layered

One confidence label is too vague. Trust requires layered confidence.

Do this:

- Add separate confidence dimensions:
  - parser confidence
  - mapping confidence
  - accounting identity confidence
  - valuation anchor confidence
  - market-input freshness confidence
  - report and export completeness confidence
- Aggregate them into a final release state only after all component checks pass.
- Show confidence degradation reasons as a list, not a color only.

Exit criteria:

- users can see exactly which subsystem is weak
- confidence can degrade without hiding usable analysis
- workbook exports remain self-explanatory out of context

## 8. Make the Workbook an Audit Artifact, Not Just a Report

The workbook should be able to defend itself.

Do this:

- Add explicit sheets or sections for:
  - input file identity
  - run id and policy versions
  - parser quality summary
  - reconciliation summary
  - valuation eligibility decision
  - anchor period selection
  - unresolved critical issues
- Fix presentation mismatches:
  - missing company name on cover
  - sheet list drift versus actual workbook contents
- Stamp every workbook with:
  - company
  - run id
  - generation timestamp
  - engine version
  - mapping policy version
  - anomaly policy version
  - valuation policy version

Exit criteria:

- workbook can be reviewed offline without UI context
- no sheet metadata drift
- workbook never implies confidence higher than the underlying run justifies

## 9. Create a Golden Reconciliation Suite

The strongest way to become convincing is to repeatedly survive adversarial known-company checks.

Do this:

- Expand beyond a couple fixtures to at least 10 audited companies:
  - clean industrials
  - messy industrials
  - demerger and discontinued cases
  - asset-light companies
  - capital-intensive companies
  - companies with large treasury assets
- For each golden company, store expectations for:
  - parser quality
  - key mapped lines
  - NOA, NFO, and CSE identities
  - major ratios in tolerance bands
  - valuation readiness state
  - anomaly flags
  - export metadata integrity
- Add mandatory approval when expectations change.

Exit criteria:

- every release runs full golden suite
- expectation changes are intentional and reviewed
- "it still works on real companies" becomes measurable

## 10. Add Sheet-by-Sheet Output Reconciliation Tests

If the workbook is a product artifact, test it as such.

Do this:

- Programmatically open the generated workbook and validate:
  - company metadata
  - sheet presence and naming
  - critical cell values
  - formula outputs where applicable
  - text explanations for blocked and guarded cases
- Cross-check workbook values against:
  - snapshot `rawData`
  - `recastData`
  - internal valuation outputs

Exit criteria:

- workbook regressions fail CI
- presentation drift is caught automatically
- reported cells match underlying model outputs

## 11. Build a Residuals Dashboard

Trust improves when the model quantifies what it cannot explain.

Do this:

- Track residuals and unresolved counts per run:
  - parser residuals
  - mapping unresolved by severity
  - identity equation residuals
  - valuation bridge residuals
  - duplicate concept groups
  - null-density hotspots
- Trend these across runs and releases.
- Require residual thresholds for production-ready state.

Exit criteria:

- residuals are visible over time
- quality is improving measurably, not impressionistically
- model changes can be judged by whether they reduce unexplained variance

## 12. Add Source-to-Output Traceability for Every Material Number

A reviewer should be able to ask "where did this come from?" and get a precise answer.

Do this:

- For every major reported number, store:
  - source file or files
  - source metric keys
  - transformation steps
  - formulas applied
  - policy decisions applied
  - confidence
- Make this available in:
  - API payload
  - workbook provenance sheet
  - UI inspector

Exit criteria:

- every major valuation and recast number is drillable to source
- no major reported number is an opaque black box

## 13. Add Strong Release Gates

The model should fail closed.

Release should fail if any of these are true:

- parser fidelity below threshold
- unresolved Tier A concept in valuation path
- identity residual above threshold
- valuation anchor contaminated without explicit block or fallback
- workbook metadata mismatch
- golden-company expectation regression
- duplicate concept explosion above threshold
- raw normalization still producing unscoped analytical keys

## 14. Clarify What "Economically Correct" Means

Define the standard instead of leaving it implicit.

Use these levels:

- `syntactically valid`
  - JSON parses and schema shape is correct
- `structurally reconciled`
  - accounting identities and statement ties hold
- `economically plausible`
  - anomalies are explainable and policy-classified
- `valuation eligible`
  - terminal anchor is clean enough for valuation
- `production-ready`
  - all above pass, and export and report surfaces match confidence truthfully

This matters because "all numbers are correct" is too vague. The model should explicitly say which level a run has achieved.

## Recommended Sequencing

1. Normalize raw metric schema and eliminate mixed scoped and unscoped analytical keys.
2. Add canonical concept identity and collision handling.
3. Add parser fidelity checks and reconciliation packs.
4. Harden anomaly, unusual-item, and terminal-anchor policy.
5. Fix workbook metadata and report integrity issues.
6. Expand golden-company and workbook regression suites.
7. Add residual dashboards and stronger release gates.
8. Only after that, broaden model complexity further.

## What Would Convince Me

I would consider the model genuinely clean and convincing when a real audited run shows all of the following:

- uploaded source artifact is preserved and inspectable
- parsed statement extraction ties back to source cells
- normalized metrics have one concept identity and one statement owner
- accounting identities reconcile within strict tolerances
- unusual items and capital events are classified, not hand-waved
- valuation is blocked or downgraded when the anchor is contaminated
- workbook metadata matches the run exactly
- golden-company tests pass across clean and ugly cases
- residuals are low, explicit, and trending down
- every major reported number can be traced back to source and policy
