# Plan: Harden the insurance valuation path (golden → fail-closed gate → sanity bands)

Status: PLAN ONLY. No code edited. Surfaced during the strategy-spine deletion PR
(2026-05-30) while auditing how `detectSubtype` routes insurers. Orthogonal to that
PR — tracked here as its own scoped work.
Date: 2026-05-31

---

## Goal

Close the three real gaps that keep the insurance path from being production-robust,
in dependency order. The Tier-1 plumbing (detect → extract → ratios → reconcile) is
already solid and tested (11/11 green across the 3 insurance specs); the valuation +
governance layer is where the risk lives.

## Severity reframing (why this is not cosmetic)

The product thesis is "every output is traceable and **defensible under review**."
The headline gap violates that thesis directly, so it is ranked above the missing
safety nets:

- **Gap #1 (defensibility violation, not just a ceiling):** a Capitaline-only insurer
  emits a confident **bank-framed** headline valuation (justified P/B on book value,
  DDM on dividends) — economically wrong for a life insurer, where book value and ROE
  do not carry bank meaning. It does not fail or blank; it prints a wrong number that
  looks right. This is worse than a blocked valuation.
- **Gaps #2 and #3** are *missing safety nets* (no golden regression, no sanity bands).
  They don't produce a wrong number; they fail to *catch* one.

## Verified on disk (2026-05-31)

1. **The fallback is real, not hypothetical.** `evBasedValuation` (`bankValuation/coreModels.ts:167-170`)
   returns `skipped("Embedded Value sidecar data unavailable …")` when no period carries
   `quality.embedded_value`. EV/VNB is an annual-report extraction, NOT in standard
   Capitaline exports. So a Capitaline-only insurer gets NO appraisal value and falls
   through to the bank-framed models. → Gap #1 is a **fail-closed gate**, not a banner.
2. **No sanity bands by design.** `pipeline.ts:176-177` maps `subtype === "insurance"`
   to `"auto"` with the comment `// insurance has no sanity bands`, so
   `evaluateRatioSanity` never range-checks insurance output. Bank/NBFC get NIM/ROA/ROE
   band checks; a nonsense combined ratio or float multiple on an insurer sails through
   (only the hard combined-ratio<150% reconciliation check catches the extreme case).
3. **No audited insurance golden case.** Golden suite has HDFC Bank (bank) and Bajaj
   Finance (NBFC) as full ingest→value runs from audited fixtures. Insurance has only
   unit-style accuracy specs (`computeBankValuation` with hand-built metrics) plus a
   **synthetic** LIC pipeline test (`insurancePipeline.spec.ts:7-68` is fabricated data,
   not an audited fixture). The end-to-end insurance path is not golden-protected; a
   parser regression on an insurer would not trip a golden gate.
4. **What is solid (do not touch):** detection (LIC → supported-financial, not blocked),
   extraction (policyholderFunds/premiumEarned/claimsExpense/investmentIncome), insurance
   ratios (claims/expense/combined/floatToEquity/premiumGrowth/investmentYield), EV/VNB
   appraisal **when the sidecar is supplied** (test confirms `95,000 + 9,500×12 = 209,000`),
   and the two insurance reconciliation checks (liability coverage, combined-ratio<150%).

## Ordering: severity vs. safe-sequencing are different axes

By **severity**, the gate is #1 (it's the only fix that addresses the wrong number).
By **safe-sequencing**, golden is first — as *enabling infrastructure*, not as the fix:
you need a regression net before touching valuation dispatch, or you risk breaking the
working sidecar-supplied path. They are not competing rankings; **golden is the
prerequisite, the gate is the payload.**

Sequence:
1. **PR-INS-1 — Audited insurance golden fixture (enabling infra).** Slots into Plan 2.2
   (audited fixtures). Capture a real insurer (e.g. HDFC Life or SBI Life — confirm a
   Capitaline ZIP exists in `public/data/companies/` first; if not, this is a
   data-acquisition prerequisite) via `scripts/refresh-company.mjs`. Add the audited dump
   to `src/engine/__fixtures__/`, and a GOLDEN_COMPANY_CASE with ±5% bands. **Capture two
   variants if possible:** one WITH an EV/VNB sidecar (locks the correct appraisal path)
   and one WITHOUT (locks whatever the gate decides the no-sidecar headline should be).
2. **PR-INS-2 — Fail-closed gate on the appraisal lens (the payload).** When
   `subtype === "insurance"` AND `evBasedValuation` is skipped (no sidecar), do NOT present
   bank-framed DDM/ERI/justified-P/B as the insurer's headline valuation. Fail closed:
   block `valuation-eligible` advancement and surface an explicit
   "Insurance appraisal lens inactive — supply EV/VNB via quality_indicators.json"
   state, consistent with the **Fail-Closed** guiding principle. Wire the block into the
   rigor-ladder downgrade gate. **Risk to verify before coding:** the HDFC Life / LIC
   accuracy specs SUPPLY embedded_value, so they exercise the active path and should be
   unaffected — confirm no test asserts a bank-framed number on a sidecar-less insurer.
3. **PR-INS-3 — Insurance sanity bands (polish).** Replace the `pipeline.ts:177`
   `"auto"` punt with real insurance bands in `ratioSanity.ts`: plausible ranges for
   combinedRatio, expenseRatio, claimsRatio, floatToEquity, investmentYield. Range-check
   insurance output the way bank/NBFC output is checked today.

## Out of scope

- The typed `SectorBands` contract (separate ADR) — PR-INS-3's bands may inform it but
  must not block on it.
- Any change to the bank/NBFC valuation paths.

## Verification per PR
- PR-INS-1: `npm run test:golden` green with the new insurer case; `npm run validate`.
- PR-INS-2: new spec — sidecar-less insurer fixture asserts headline is the fail-closed
  state (NOT a bank-framed number); sidecar-supplied insurer still values via EV/VNB.
  `test:golden` unchanged for the WITH-sidecar variant.
- PR-INS-3: new spec — out-of-range combined ratio / float multiple flips ratio-sanity to
  warning/critical; in-range insurer passes clean.

## Iteration log
| # | Change | Why |
|---|--------|-----|
| 1 | Drafted from 3-gap audit; reframed gap #1 from "ceiling" to defensibility violation | A wrong-but-confident headline breaks the traceability thesis harder than a blocked one |
| 2 | Confirmed fallback is real (coreModels.ts:168-170 skipped → bank-framed) → gap #1 is a fail-closed GATE, not a banner | Read the dispatch; sidecar-less insurer falls through, doesn't blank |
| 3 | Separated severity (gate #1) from safe-sequencing (golden first as infra) | Golden pins behavior; it doesn't fix the wrong number — needed as net before touching dispatch |
