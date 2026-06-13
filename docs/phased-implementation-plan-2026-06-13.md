# Phased Implementation Plan — Rigor Hardening + Sector-Native Valuation

## Assumptions

1. Goal is **valuation/defensibility improvement**, not a UI rewrite.
2. Every phase ships with tests and leaves `npm run validate` green.
3. We prioritize the work that moves the scorecard from ~7.3/10 toward reviewer-ready (8.5+/10).
4. Existing shared-trust envelope, trace logger, and chart wiring are preserved.

## Status quo (verified)

- `telecom` / `utility` **sector templates** and readiness gates exist (`valuationSectorTemplates.ts`, `reconciliationResiduals.ts`).
- `telecom` / `utility` still run the **industrial Penman-Nissim model**; the rigor cap lifts only when sector evidence is present, but no sector-native valuation model exists.
- `auditCompanyRun.ts` already fetches Yahoo Finance market data and `analysisTraceability.ts` already builds a `lineageRef`.
- `scripts/lib/valuationMaturityScorecard.ts` correctly accepts `confirmed`/`degraded`/`guarded` runtime values, so the low score reflects **real gaps**, not enum mismatches.
- The biggest real gaps today are:
  1. `source-lineage-missing` on ~10/33 rows.
  2. `market-freshness-source-unavailable` on 33/33 rows.
  3. `sector-native-strategy-missing` for telecom/utility/loss-maker/conglomerate rows.
  4. `single-valuation-spine` / weak cross-paradigm independence.

---

## Phase 1 — Rigor and trust-surface hardening

**Goal:** make the scorecard honestly reflect the quality that already exists by fixing lineage wiring, ticker parity, and type coverage in scripts/API.

### 1.1 Remove the duplicate `AccountingStandardCoverage` interface

- File: `src/engine/types/traceabilityEnvelope.ts` (lines 31-61).
- Change: delete the second declaration. TypeScript already rejects this under stricter flags; it is a latent compilation fault.
- Test: `npm run typecheck` must remain green.

### 1.2 Complete source-cell lineage for all audited rows

The `lineageRef` is built in `analysisTraceability.ts`, but two gaps leave some audit rows without complete evidence:

1. `buildLineageMap` is not passed `intrinsicValuePerShareByPeriod`, so the `intrinsic-value-per-share` concept is always `estimated`.
2. Derived concepts (`noa`, `nfo`, `core-oi`, `rnoa`, `free-cash-flow`) report synthetic keys like `BS.TA` instead of the **actual raw composite keys** that fed the period.

Changes:
- In `analysisTraceability.ts`, compute a per-period `intrinsicValuePerShareByPeriod` map from `params.valuationTriangulation` (or command-center output when available) and pass it to `buildLineageMap`.
- In `lineageBuilder.ts`, for derived concepts, look up the real raw keys via `findRawMetric` using the alias lists already present in `CONCEPT_RAW_ALIASES`, and include the actual resolved composite key(s).
- For `rnoa`, emit both `CoreOI` source keys and the two `NOA` periods used in the average.

Tests:
- `src/engine/__tests__/lineageBuilder.spec.ts`:
  - For an ITC-like fixture, every `LINEAGE_CONCEPT_ID` has a non-empty `sourceMetricKeys` array.
  - `intrinsic-value-per-share` has `confidence: "high"` when valuation output is provided.
  - `rnoa` lineage contains keys for both current and prior-period `NOA`.
- `scripts/__tests__/auditCompanyRun.spec.ts`:
  - Every audited company returns `sourceEvidence.lineageRef.hasLineage === true`, `conceptCount >= 8`, `periodCount >= 1`, and a valid hex `checksum`.

### 1.3 Typecheck `scripts/` and `api/`

- Create `tsconfig.scripts.json` extending the root config, including `scripts/**/*.ts` and `api/**/*.js` with `allowJs: true` and `checkJs: true`.
- Add npm script: `"typecheck:scripts": "tsc -p tsconfig.scripts.json --noEmit"`.
- Add it to `validate` before `test`.
- Fix the resulting errors surgically. Common issues expected:
  - Implicit `any` in `api/**/*.js`.
  - Missing types for CLI argument parsers in scripts.

Tests:
- `npm run typecheck:scripts` passes.
- `npm run validate` still passes.

### 1.4 Fix market-freshness source-unavailable

`auditCompanyRun.ts::fetchMarketEvidence` already calls Yahoo Finance. The 33-row failure is almost certainly ticker drift across three sources of truth (`registry.json`, `CompanyLibraryGrid.tsx`, `nseSymbolRegistry.ts`) plus no offline fallback.

Changes:
- Add `scripts/verify-ticker-parity.ts` that asserts the three sources agree for every company. Run it in CI (`validate` or pre-audit).
- In `fetchMarketEvidence`, if the Yahoo fetch returns 404, try the symbol from `nseSymbolRegistry.ts` for the same company before giving up.
- Add an offline fallback: if `process.env.PENMAN_OFFLINE_AUDIT === "1"`, read `public/data/companies/<folder>/market_snapshot.json` (schema: `{ price: number, asOf: string, source: string }`) and treat it as fresh.
- Commit `market_snapshot.json` for the stable golden companies (ITC, Asian Paints, VST) so CI can pass without network.

Tests:
- `scripts/__tests__/auditCompanyRun.spec.ts`:
  - A company with a valid ticker returns `marketEvidence.status === "fresh"` and at least one input.
  - A deliberately wrong ticker returns `source_unavailable` with a reason containing the HTTP status.
  - Offline mode returns `fresh` using the local snapshot.
- New `scripts/__tests__/tickerParity.spec.ts`:
  - For every `registry.json` entry, `CompanyLibraryGrid.tsx` and `nseSymbolRegistry.ts` agree on the ticker (case-insensitive after trimming `.NS`).

### 1.5 Regenerate scorecard baseline and update docs

- Run `npm run test:audit` after 1.1-1.4.
- Run `npx tsx scripts/valuation-scorecard.ts --format md > docs/valuation-maturity-baseline-2026-06.md`.
- Update `docs/financial-model-rigor-plan.md` to mark the lineage and market-freshness exit criteria as implemented.

### Phase 1 success criteria

1. `source-lineage-missing` blockers drop from ~10 to 0.
2. `market-freshness-source-unavailable` drops from 33 to 0 for companies with valid tickers/snapshots.
3. `npm run validate` and `npm run test:audit` pass.
4. Scorecard overall score improves to ≥8.0/10 (from ~7.3).

---

## Phase 2 — Sector-native valuation models

**Goal:** replace the industrial Penman-Nissim fallback for telecom/utility/real-estate/holding companies with source-backed sector models.

| Sector | Model | Key inputs | Unlock condition |
|---|---|---|---|
| Telecom | DCF with ARPU / subscribers / spectrum amortization | Revenue, spectrum assets, network opex, license fees, capex, subscriber base (sidecar) | `detected-telecom-unmodelled` + readiness confirmed |
| Utility | Regulated Asset Base (RAB) DCF | PPE, CWIP, regulatory deferrals, allowed ROE, finance cost | `detected-utility-unmodelled` + readiness confirmed |
| Real estate | NAV / cap-rate | Investment property, NOI, debt, cap rate (sidecar) | `company_type === "real-estate"` |
| Holding company | Listed-subsidiary SOTP + unlisted book-value fallback | Subsidiary financials from Capitaline `Subsidiaries_*.xls` | `company_type === "holding"` or conglomerate with ≥50% unlisted subsidiaries |

Changes:
- Add `src/engine/valuation/telecomValuation.ts`, `utilityValuation.ts`, `realEstateValuation.ts`, `holdingSotpValuation.ts`.
- Add sector types to `CompanyType` union and `scopePolicy.ts` signal groups.
- Route sector-native companies through a new `SectorNativeCommandCenter` path in `valuationCommandCenter.ts` while keeping the existing industrial path untouched.
- Add sector-native valuation lenses to `FrameworkRadar` and `ValuationReport`.

Tests:
- `src/engine/__tests__/telecomValuation.spec.ts`:
  - Sanity: per-share value > 0 for a healthy fixture.
  - Spectrum amortization reduces value vs no-amortization.
- `src/engine/__tests__/utilityValuation.spec.ts`:
  - RAB-derived equity value ties to `PPE + CWIP + regulatory deferral − NFO`.
- `src/engine/__tests__/holdingSotp.spec.ts`:
  - Listed subsidiary contribution equals market value × ownership; unlisted uses book value.
- Update `sectorLadderCap.spec.ts`: when sector-native model runs, `valuation-eligible` is reachable.

---

## Phase 3 — Cross-paradigm independence and anti-tautology

**Goal:** reduce `single-valuation-spine` warnings and remove circular price-driven assumptions.

Changes:
- In `reverseDCF.ts`, split output into:
  - `price-implied` (uses market price).
  - `model-implied` (uses normalized growth anchor independent of price).
- Add independent cash/relative lenses for banks/NBFCs (e.g., P/B-ROE regression, cost-to-income implied value).
- Expand `FrameworkRadar` to show divergence between accrual, cash, relative, and sector-native axes.
- Add `antiTautology` envelope field documenting which lenses are price-independent.

Tests:
- `src/engine/__tests__/antiTautology.spec.ts`:
  - For ITC, at least three independent lens groups produce values within 2× of each other.
  - `reverseDCF.impliedOwnerEarningsGrowth` does not equal `config.g` for a manipulated fixture.

---

## Phase 4 — Quarterly / TTM bridge

**Goal:** enable analysis for companies with only recent quarterly data.

Changes:
- Extend `capitalineParser.ts` to ingest quarterly Capitaline files.
- Add `src/engine/ttmRecast.ts` that rolls the latest four quarters into a TTM period.
- Wire TTM as a fallback when annual periods < 3.

Tests:
- `src/engine/__tests__/ttmRecast.spec.ts`:
  - TTM revenue equals sum of four quarters.
  - TTM ratios fall inside expected bands vs the same company’s annual ratios.

---

## Phase 5 — Engineering cleanup

**Goal:** pay down structural debt exposed by the previous phases.

Changes:
- Split `valuationCommandCenter.ts` into smaller builders (planned in `references/module-decomposition.md`).
- Clean the 208 untracked files in the workspace (`git status` shows untracked scratch / cache files).
- Add a CI step that fails on new untracked files after `npm run validate`.

Tests:
- `npm run validate` passes on a clean checkout.
- `git status --porcelain` shows only expected ignored artifacts after CI runs.

---

## Risks and open questions

1. **Telecom subscriber data is not in Capitaline exports.** We will need a small sidecar schema (`telecom_metrics.json`) or AR-page extraction. Is that acceptable, or should we rely only on Capitaline-exported line items?
2. **Holding-company SOTP** depends on accurate ownership percentages. Should ownership come from Capitaline `Subsidiaries_*.xls` (often 100% rows) or a user-supplied sidecar?
3. **Real-estate cap rate** is not in financial statements. We will need either a user input default (e.g., 8%) or an India-specific REIT-implied cap rate fetch. Which is preferred?

---

## Commands to run after each phase

```bash
npm run typecheck
npm run test
npm run test:golden
npm run test:audit
npm run build
npx tsx scripts/valuation-scorecard.ts --format md > docs/valuation-maturity-baseline-$(date +%Y-%m-%d).md
```
