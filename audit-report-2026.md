# Audit Report 2026

## Scope

Requested task:

1. Hit the Penman V2 audit API and identify the raw input file.
2. Analyze the JSON structure for errors.
3. Write the findings to `audit-report-2026.md`.

## Audit Endpoint Used

Authenticated live endpoint:

```text
GET https://penman-v2-analysis-vercel.vercel.app/api/audit/runs?runId=243da112-8772-4c74-adda-b132017600c8&includePayload=1
```

This returned a full run payload for the ITC audit run.

## Raw Input File Found

From the live audit response:

- run id: `243da112-8772-4c74-adda-b132017600c8`
- company: `ITC`
- source mode: `capitaline`
- raw input file path:
  - `audit-runs/243da112-8772-4c74-adda-b132017600c8/inputs/financiall data.zip`
- raw input file size:
  - `275337` bytes
- analysis snapshot event timestamp:
  - `2026-03-29T16:57:21.194Z`

Important distinction:

- the raw uploaded file is a ZIP blob,
- the JSON analyzed below is the live `analysis-snapshot.payload.rawData` structure retrieved from the audit API.

## JSON Payload Analyzed

The live `analysis-snapshot.payload` contains these top-level keys:

- `companyId`
- `periodCount`
- `latestPeriod`
- `config`
- `qualityGate`
- `engineError`
- `debugInfo`
- `rawData`
- `recastData`

The actual period entries inside `rawData` use this shape:

- `company_id`
- `period_end`
- `raw_metric_values`

## Structural Validation Summary

### Shape checks

- JSON parsed successfully
- `rawData` is an array
- period count: `15`
- company ids found: `["ITC"]`
- first period: `2011-03-31`
- last period: `2025-03-31`
- duplicate period ends: none
- malformed period objects: none

### What is structurally correct

- top-level audit payload shape is consistent
- every `rawData` row is an object
- every `rawData` row has the expected three fields
- no duplicate periods were found
- no period rows failed the basic shape check

## Findings

### 1. Mixed scoped and unscoped metric keys

This is the largest structural issue.

Inside `raw_metric_values`, the dataset mixes:

- statement-scoped keys such as `Metric__BalanceSheet`
- unscoped keys such as `Metric`

Counts from the live ITC payload:

- scoped keys: `24615`
- unscoped keys: `23895`

This means almost half of the raw metric map lacks explicit statement scope.

Why this matters:

- concept ownership becomes ambiguous
- the same metric can appear in multiple statements
- downstream mapping and audit logic has to infer too much

Severity:

- `high`

### 2. Duplicate-concept groups caused by inconsistent naming

The live payload contains many concept groups that differ only by punctuation, capitalization, spacing, or suffix style.

Examples found directly in the ITC payload:

- `Work-in-Progress__BalanceSheet`
- `Work-in-progress__BalanceSheet`
- `Work-in-progress__ProfitLoss`
- `Work-in-Progress__ProfitLoss`
- `Work-in-Progress`
- `Work-in-progress`

- `Capital Work in Progress__BalanceSheet`
- `Capital Work-in-Progress__BalanceSheet`
- `Capital Work in Progress`
- `Capital Work-in-Progress`

- `Share Application Money__BalanceSheet`
- `Share Application Money :__BalanceSheet`
- `Share Application Money__CashFlow`
- `Share Application Money`
- `Share Application Money :`

- `Inter-corporate Deposits__BalanceSheet`
- `Inter Corporate Deposits__BalanceSheet`
- `Inter Corporate Deposits__CashFlow`
- `Inter-corporate Deposits`
- `Inter Corporate Deposits`

Why this matters:

- increases collision risk
- makes canonical mapping harder
- can create false unmatched-label noise
- can fragment one economic concept into several pseudo-concepts

Severity:

- `high`

### 3. High null density

Nulls are valid JSON, but there are many of them.

Observed null count in the live ITC payload:

- `6620`

Why this matters:

- sparse concepts can look present even when they are effectively absent
- downstream logic may not distinguish `missing`, `not applicable`, and `provided but null`
- quality or coverage reporting can become overstated

Severity:

- `medium`

### 4. The JSON is valid, but it is not a clean normalized schema

I did not find:

- broken JSON syntax
- malformed period rows
- duplicate period-end entries

So the problem is not that the file is unreadable.

The problem is that the schema is only partially normalized. It combines:

- raw-like labels,
- statement-scoped keys,
- unscoped keys,
- and multiple textual variants of the same concept.

Severity:

- `high`

## Error Assessment

### Fatal errors

None found.

### Structural/schema errors

- mixed scoped and unscoped metric keys
- repeated concepts under multiple naming variants
- high null density without richer null semantics

### Operational note

The live audit API access itself works when an audit admin token is supplied. The audit endpoint is not the problem here; the payload normalization quality is.

## Practical Conclusion

The live ITC audit JSON is valid and usable, but it is not cleanly normalized.

The main issue is schema consistency, not parsing failure:

1. too many metric keys are missing explicit statement scope
2. the same concept often appears under several textual variants
3. null handling is dense and semantically weak

So the data is suitable for analysis with existing Penman logic, but it still carries enough schema ambiguity to create mapping drift, duplicate concept handling, and noisy audit diagnostics.

## Recommended Fixes

1. Enforce one persisted metric-key format.
   Either always persist `metric__statement` keys or store statement ownership as a separate typed field.

2. Add canonical concept normalization before snapshot persistence.
   Collapse spelling, punctuation, and case variants into one canonical concept id.

3. Separate source blob storage from normalized analytical payloads.
   The uploaded ZIP should remain one artifact; normalized `rawData` should be a clearly different object with stricter schema guarantees.

4. Distinguish `missing`, `null`, and `not applicable`.
   That will reduce ambiguity in downstream analytics and audit reporting.

5. Add a schema-quality gate in audit snapshots.
   Emit explicit counts for:
   - scoped keys
   - unscoped keys
   - duplicate concept groups
   - null density

## Supporting Evidence

Relevant server-side files:

- `api/audit/runs.js`
- `api/audit/events.js`
- `api/audit/_lib.js`
- `scripts/fetch-audited-run-fixture.mjs`

Live audit evidence used:

- run id: `243da112-8772-4c74-adda-b132017600c8`
- input blob: `audit-runs/243da112-8772-4c74-adda-b132017600c8/inputs/financiall data.zip`
- analysis snapshot from `/api/audit/runs?runId=...&includePayload=1`
