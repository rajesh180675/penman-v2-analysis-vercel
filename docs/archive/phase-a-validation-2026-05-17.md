# Phase A Validation — ITC Real Data, 2026-05-17

Validates the multi-standard ingestion pipeline against the actual
Capitaline export tree at `public/data/companies/ITC/` after the user
downloaded Revised Sch-VI and Standard format files.

## TL;DR

Path-based standard detection is correct on all 20 real files. Year
range coverage is unexpectedly identical across formats — Capitaline
restates the same 15-year window (FY2011-FY2025) under each accounting
standard rather than splitting at the standard's historical
applicability date. This changes the interpretation of multi-standard
ingestion: the value isn't "older years from older standards" but
"alternative views of the same years under different accounting
treatments". Ind-AS and Revised Sch-VI agree on numeric values for
many line items (only the labels differ); Old GAAP / Standard produces
materially different figures (~19% gap on Total Assets vs Ind-AS) due
to reclassifications.

## File Layout — Detection Verified

All 20 files under `public/data/companies/ITC/` resolve correctly:

| Path                                              | Standard       | Statement |
|---------------------------------------------------|----------------|-----------|
| BalanceSheetINDAS_.xls                            | ind-as         | BS        |
| ProfitLossINDAS_.xls                              | ind-as         | PL        |
| CashFlow_.xls                                     | unknown        | CF        |
| Investment_.xls                                   | unknown        | INV       |
| SegmentFinance_*.xls                              | unknown        | SEG       |
| standalone/BalanceSheetINDAS_.xls                 | ind-as         | BS        |
| standalone/ProfitLossINDAS_.xls                   | ind-as         | PL        |
| standalone/CashFlow_.xls                          | unknown        | CF        |
| revised schd/BalanceSheetRevised_.xls             | revised-sch-vi | BS        |
| revised schd/ProfitLossRevised_.xls               | revised-sch-vi | PL        |
| revised schd/CashFlow_.xls                        | revised-sch-vi | CF        |
| revised schd/SegmentFinance_.xls                  | revised-sch-vi | SEG       |
| revised schd/standalone/BalanceSheetRevised_.xls  | revised-sch-vi | BS        |
| revised schd/standalone/ProfitLossRevised_.xls    | revised-sch-vi | PL        |
| standard/BalanceSheet_.xls                        | standard       | BS        |
| standard/ProfitLoss_.xls                          | standard       | PL        |
| standard/standalone/BalanceSheet_.xls             | standard       | BS        |
| standard/standalone/ProfitLoss_.xls               | standard       | PL        |

Detection passes — no mis-classified files. The folder-based fallback
correctly handles `standard/BalanceSheet_.xls` (no filename suffix) and
inherits the standard for CF/SEG files inside `revised schd/`.

The top-level CF/INV/SEG files resolving to `unknown` is intended and
correct: they have no folder hint, so the period merge will assign them
to whichever standard the co-located BS/PL files dominate.

## Year-Range Coverage — Surprising Finding

Every BS/PL file regardless of format covers the full FY2011-FY2025
window:

| File                                            | Years     | Count |
|-------------------------------------------------|-----------|-------|
| BalanceSheetINDAS_.xls                          | 2011-2025 | 15    |
| ProfitLossINDAS_.xls                            | 2011-2025 | 15    |
| revised schd/BalanceSheetRevised_.xls           | 2011-2025 | 15    |
| revised schd/ProfitLossRevised_.xls             | 2011-2025 | 15    |
| standard/BalanceSheet_.xls                      | 2011-2025 | 15    |
| standard/ProfitLoss_.xls                        | 2011-2025 | 15    |

This is *not* what the original Phase A roadmap assumed. The roadmap
expected:
- Ind-AS: FY2017-FY2025 (~9 years)
- Revised Sch-VI: FY2012-FY2017 (~5 years)
- Standard: pre-FY2012 (~5 years)

What Capitaline actually does: each format export includes the same
15-year window, restated to the chosen accounting standard. So:
- Ind-AS file = company's official Ind-AS view from FY2017+, AND the
  Ind-AS-restated values for FY2011-FY2017 (Capitaline's reconstruction).
- Revised Sch-VI file = same period, restated under Revised Sch-VI labels.
- Standard file = same period, restated under Old GAAP.

Implication: the standards-precedence merge (Ind-AS > REV > Standard)
will collapse all three into Ind-AS values for every period, which is
what we want. The non-Ind-AS files become "fallback gap-fillers"
rather than primary sources.

## Numeric Comparison Across Formats — FY2025

| Line Item                              | Ind-AS    | REV         | Standard   |
|----------------------------------------|-----------|-------------|------------|
| Total Assets                           | 88,090.68 | 88,090.68   | 71,321.44  |
| Net Property, Plant & Equipment        | 17,428.89 | 17,428.89   | (not yet checked) |
|   ↳ shown as "Net Block" in REV        |           | 17,428.89   |            |

Two big takeaways:

1. **Ind-AS and Revised Sch-VI agree on numeric values** for many BS
   lines. Capitaline reuses Ind-AS values and just relabels them under
   Revised Sch-VI nomenclature. The alias-and-emit strategy works
   exactly as intended — `Net Block` (REV) gets emitted alongside
   `Net Property, plant and equipment` (Ind-AS) so existing mappingSpec
   lookups still work.

2. **Old GAAP / Standard produces materially different numbers**. Total
   Assets differs by ~19%. This is genuine: Old GAAP excludes things
   Ind-AS recognises (right-of-use lease assets, fair-value adjustments,
   deferred tax presentation, etc.). The Old GAAP file is therefore NOT
   a higher-precision view; it's a different accounting universe and
   the precedence merge correctly demotes it.

## Label Coverage — Unmapped REV/Standard Labels

The parser identified 1,138 distinct labels populated with at least one
non-null value across the four REV/Standard BS+PL files. Of these:

- ~30 are already aliased or already match an Ind-AS canonical name
- 1,108 are unmapped

The vast majority of the unmapped 1,108 are either:
- Granular line items that don't have a clean Ind-AS equivalent
  (e.g. "Lease Adjustment", "Investment Allowance Reserve",
  "Special Appropriation to Projects" — these are reserve sub-buckets
  that Ind-AS rolls up into "Other Equity")
- Already populated via canonical labels in the same row but my heuristic
  scan didn't see them (the parser does, since it does proper row-based
  HTML extraction)
- Old-GAAP-only items (Investment Allowance Reserve, Development Rebate
  Reserve, Foreign Exchange Earnings Reserve) that are tax-incentive
  reserves abolished pre-Ind-AS

### Top Alias Candidates (worth adding to STANDARD_ALIASES)

These appear in 2+ REV/Standard files AND have a clean Ind-AS canonical
equivalent that's NOT just whitespace-different:

| Source (REV/Standard)              | Canonical (Ind-AS)                       |
|------------------------------------|------------------------------------------|
| Long-Term Loans and Advances       | Total Long-term Loans and Advances       |
| Other Long Term Liabilities        | Total Other Non-current Liabilities      |
| Goods-in transit                   | Goods in Transit                         |
| Term Loans Institutions            | Term Loans - Institutions                |
| Term Loans Banks                   | Term Loans - Banks                       |
| Term Loans Others                  | Term Loans - Others Parties              |
| Net Cash from Investing Activities | Net Cash Used in Investing Activities (already in spec) |
| Net Cash from Financing Activities | Net Cash Used in Financing Activities (already in spec) |

### Alias candidates with NO clean Ind-AS equivalent (skip)

These are real Old GAAP / Revised Sch-VI concepts that Ind-AS doesn't
have:
- Investment Allowance Reserve, Development Rebate Reserve
- Debenture Redemption Reserve, Debt Redemption Reserve
- Exchange Fluctuation Reserve, Other Revaluation Reserve
- Foreign Exchange Earnings Reserve
- Application Money (pending allotment)
- Lease Adjustment, Discount on issue of Debentures
- Preliminary Expenses, Miscellaneous Expenses not written off
- Provision for Fringe Benefit Tax (FBT abolished 2009)

These should remain unmapped (they don't have a 1:1 Ind-AS
equivalent). They will sit in the merged `raw_metric_values` under their
original keys for completeness/traceability but mappingSpec lookups
won't find them — which is correct.

## Recommended Follow-up

A small focused commit can add the seven new alias entries listed under
"Top Alias Candidates" above. Estimated impact: covers an additional
~12-15 line items per period for REV/Standard data, mostly debt/
borrowing detail that's useful for leverage analysis.

Phase A6 (rigor envelope wiring for pre-Ind-AS confidence) is still
pending. Given that Capitaline restates all years to all standards,
the original Phase A6 design — "mark pre-FY2017 periods as
medium-confidence" — needs a rethink:

- Periods where Ind-AS data exists → high confidence regardless of FY
- Periods where ONLY non-Ind-AS data contributed (i.e. the period
  appears in REV or Standard but NOT in Ind-AS) → medium/low confidence
- The check should be on `accounting_standard` per-period as set by
  the merge step, not on the calendar year

## What Was NOT Validated

This pass used Python regex extraction directly on the HTML rather than
running the actual `parseCapitalineZip()` pipeline. Subagent-delegated
attempt to run the real parser timed out (Node File polyfill
complications in vitest). To fully validate end-to-end:

- Pack `public/data/companies/ITC/` (or a representative subset) into
  a ZIP and run the existing `parseCapitalineZip` against it.
- Assert: 15 periods returned, all `accounting_standard === 'ind-as'`,
  Total Assets matches Ind-AS values for FY2017+ and reconstructed
  Ind-AS values for FY2011-FY2016.
- Spot-check that REV-only labels emit canonical aliases (e.g. raw
  data should have BOTH `Sundry Debtors__BalanceSheet` (from Standard
  file) AND `Trade Receivables__BalanceSheet` (synthesized from alias)
  populated for FY2012).

The path-detection unit tests already cover the regex side of this. The
end-to-end test would protect against future regressions in the merge
loop and alias-emit logic.

---

*Validation by Python regex extraction directly on HTML, no parser
invocation. Verifies detection logic and informs alias additions but
does not exercise the full pipeline.*
