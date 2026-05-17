# Next-Phase Roadmap — Beyond ITC + HDFC Bank Ind-AS

Companion to `COMPREHENSIVE-VALUATION-DESIGN.md`. The design doc says *what* a 10/10
tool looks like. This doc says *what to do next* given the actual state of the engine
post code-review-2026-05-17 fixes, and given the user's stated constraint:

> "data is for itc and hdfc bank, I wanted this application to work for all
> companies and not fail … go beyond these all limitations."

Status legend: ✅ done · 🟡 partial · 🔴 not built · ⚠ failure mode

---

## Part 0 — Where we actually are (post code-review fixes)

| Layer | Status | Notes |
|------|--------|-------|
| HTML dual-format parser (ng-binding + td.datarow) | ✅ | `capitalineParser.ts` — fixed cleanCell for nested ng-binding divs (Vodafone Idea) |
| Ind-AS BS / PL / CF ingestion | ✅ | INDAS files only, hard-coded in `stmtFromFilename` |
| Segment parser (industrial) | ✅ | `segmentParser.ts`, ITC 6 segments |
| Scope detection (Consolidated / Standalone) | ✅ | `scopeDetection.ts` w/ confidence tag |
| Scope policy (4 classifications + fail-closed) | ✅ | `scopePolicy.ts` post-C4/C5 |
| Industrial pipeline (Penman-Nissim full) | ✅ | `pipeline.ts` → `PenmanNissimEngine.ts` |
| Bank pipeline (NII, NIM, ROA, P/B) | ✅ | `bankPipeline.ts` + Phase B5.5 quality_indicators.json for HDFC/ICICI/SBI/Kotak |
| Moat / capital-allocation / EPV / relative valuation | ✅ | post C7-C12, all share single `kw` |
| Monte Carlo + Ohlson reversion CV | ✅ | wired in `v3Analytics.ts` |
| Cyclical normalization | ✅ | `cyclicalityDetector.ts` wired into pipeline + UI banner, cycle-normalised terminal RE anchor |
| IT-services-aware adjustments (employee cost, utilization) | ✅ | `itServicesDetector.ts` + employeeCostRatio + moat scorer awareness |
| Loss-maker valuation (negative networth / chronic losses) | ✅ | `lossMakerValuation.ts` wired into pipeline + UI (Vodafone Idea validated) |
| Quarterly ingestion | 🔴 | filename detection misses quarterly exports |
| Market data (price, market cap, beta) | 🔴 | only manual `marketCap` config input |
| Peer group / relative valuation across companies | 🟡 | `relativeValuation.ts` is intra-company time-series, no cross-company |
| Batch mode / company universe | 🔴 | one-company-at-a-time UI |

The `mixed-financial-conglomerate` class was added defensively to fail-closed —
that's correct behavior for now but it's a **wall** for ~25% of the Nifty 500
(holding cos, conglomerates with NBFC arms, insurance parents). Lifting that
wall is half of what "go beyond limitations" means.

---

## Part 1 — The two real failure modes today

### Failure mode 1: Multi-standard data is silently dropped

`stmtFromFilename(name)` in `capitalineParser.ts:226` decides statement by
substring match on `balance` / `profit` / `cash`. It does NOT distinguish:

- `BalanceSheetINDAS_.xls` (Ind-AS, FY2017-FY2025)
- `BalanceSheetREV_.xls` (Revised Schedule VI, FY2012-FY2017)
- `BalanceSheet_.xls` / `BalanceSheetSTD_.xls` (Standard / Old GAAP, pre-FY2012)

Capitaline names the export with a standard suffix. Today the user has only
INDAS files in `public/data/companies/`, but the user explicitly said:

> "Capitaline other format Standard and Schd VI have 2011 year onward data,
> you need those xls file to understand their data"

Without REV / Standard ingestion the tool can never produce 15-year history,
which kills cycle normalization for cyclicals (Tata Steel, JSW, auto OEMs)
and dilutes persistence estimation for everything else.

### Failure mode 2: The mapping spec is Ind-AS-only AND industrial-leaning

`mappingSpec.ts` carries 380 labels, almost all Ind-AS line items. There is
no:

- **Standard-aware aliasing** — "Reserves and Surplus" (Old GAAP) ≠ "Other
  Equity" (Ind-AS), but they're the same canonical bucket. Same for "Sundry
  Debtors" → "Trade Receivables", "Secured Loans" → "Long-term Borrowings",
  many CF items.
- **Bank-only labels** — "Advances", "Deposits", "CASA", "NPA", "Provision
  Coverage", "Risk-Weighted Assets". `bankPipeline.ts` reaches into raw keys
  ad hoc instead of going through a spec.
- **Insurance / NBFC / Real-estate labels** — completely absent.

The signal-based classifier in `scopePolicy.ts` *detects* these company types
but the engine has nothing to do with them once detected, except fail-closed.

---

## Part 2 — Phase plan (concrete, sequenced)

Each phase is a separate PR. Each ends green: `npm run validate` (typecheck +
384 baseline tests + new tests) clean. No phase is allowed to break the
existing ITC + HDFC Bank baselines.

### Phase A — Multi-standard ingestion (un-blocks 15Y history) ✅ shipped

Goal: every Indian company that has Capitaline coverage back to FY2011 can be
ingested as a single time series across Ind-AS + Revised Sch-VI + Standard,
with the Standard transition flagged.

Shipped commits:
- `30e86ad` feat(parser): Phase A — multi-standard ingestion
- `2541ac7` fix(parser): detect accounting standard from folder name

A1. ✅ `standardFromFilename()` recognises INDAS / REV / STD / GAAP suffixes
    AND parent folder names (`revised schd/`, `standard/`).
A2. ✅ `RawPeriodData.accounting_standard` propagates through merge.
A3. ✅ `standardAliases.ts` carries 32 conservative source→canonical aliases.
    Aliases that change semantics across standards (lease classification,
    fair-value categorisation) deliberately omitted.
A4. ✅ Parser emits BOTH the original label and the canonical Ind-AS label
    in parallel so existing mappingSpec lookups work transparently.
A5. ✅ Standard-precedence merge: Ind-AS > REV > Standard > Unknown.
A6. 🟡 Pre-Ind-AS confidence tag — type added, not yet wired into rigor
    envelope. Follow-up patch.
A7. ✅ 31 unit tests cover filename + folder + Windows backslash paths.

#### Download workflow (real Capitaline export layout)

Capitaline emits separate files per accounting standard. The user
downloads each format from the same Capitaline screen by switching
the format dropdown, and drops them into per-format subfolders:

```
public/data/companies/<TICKER>/
├── BalanceSheetINDAS_.xls           Ind-AS, FY2017+ (consolidated)
├── ProfitLossINDAS_.xls
├── CashFlow_.xls                    universal (same format across standards)
├── SegmentFinance_*.xls             universal
├── Investment_.xls                  universal
├── standalone/                      Ind-AS standalone
│   ├── BalanceSheetINDAS_.xls
│   ├── ProfitLossINDAS_.xls
│   └── CashFlow_.xls
├── revised schd/                    Revised Sch-VI, FY2012-FY2017
│   ├── BalanceSheetRevised_.xls
│   ├── ProfitLossRevised_.xls
│   ├── CashFlow_.xls                inherits "revised-sch-vi" via folder
│   ├── SegmentFinance_.xls          inherits via folder
│   └── standalone/
│       ├── BalanceSheetRevised_.xls
│       └── ProfitLossRevised_.xls
└── standard/                        Standard / Old GAAP, pre-FY2012
    ├── BalanceSheet_.xls            no filename suffix — folder is the signal
    ├── ProfitLoss_.xls
    └── standalone/
        ├── BalanceSheet_.xls
        └── ProfitLoss_.xls
```

Key facts:

1. **Cash flow and segment files are universal** across all three
   accounting standards. Only Balance Sheet and Profit & Loss vary.
   Capitaline therefore only emits the BS+PL pair when you switch
   formats — the CF inside a `revised schd/` folder is the SAME file
   you'd download under Ind-AS, just placed in the format folder for
   period-attribution purposes.
2. **Standard-format files often have NO filename suffix** — they
   come out as just `BalanceSheet_.xls`. The folder name is the only
   signal. `standardFromFilename()` reads the full path and matches
   `/standard/` anywhere in it.
3. **Standalone subfolder is per-format**. Each format folder has
   its own `standalone/` subdirectory with that format's standalone
   exports.
4. **Period precedence** is automatic: when FY2017 appears in both
   Ind-AS and Revised Sch-VI, Ind-AS wins. Lower-precedence values
   only fill nulls.

### Phase B — Bank mapping spec + valuation (HDFC + ICICI + Kotak + SBI) 🟡 partial

Goal: `bankPipeline.ts` reads from a typed mapping spec, not raw keys; same
spec covers all four major Indian banks. Engine produces NIM, CASA, GNPA,
NNPA, PCR, ROA, RWA-based capital ratios + three valuation models.

Shipped commits:
- `342fb59` feat(bank): Phase B4 — three bank valuation models with skip-with-reason

B1. ✅ `mappingSpec.bankBalanceSheet` and `bankProfitLoss` carry
    ~120 labels. Pre-existing from earlier work.
B2. ✅ Refactor `bankPipeline.ts` to use spec — done at code review C2/C3.
B3. 🔴 Bank-specific reformulation (loan-book / investment-book /
    non-earning split) — not started.
B4. ✅ Bank valuation models — three shipped:
    - Justified P/B Gordon: fair P/B = (ROE − g) / (ke − g)
    - Equity Residual Income with 5y fade to long-run 13% ROE
    - Sustainable DDM with payout × ROE consistency check
    Each independently skips with reason when prerequisites fail.
B5. ✅ Bank quality flags — shipped as Phases B5.1–B5.4:
    - B5.1: `BankQualityIndicators` type, sidecar JSON contract,
      schema validator, loader, wired into bankPipeline.ts
    - B5.2: `bankAssetQuality.ts` — six derived signals: NPA cycle,
      PCR trend, slippage trajectory, loan growth vs system, capital
      buffer, deposit franchise stability. 340-line test suite.
    - B5.3: `FinancialInstitutionReport.tsx` — Asset Quality section
      with severity-coded KPI grid, trend table, distress banners.
    - B5.4: `EngineConfig.quality_data_folder` + App.tsx sidecar fetch.
    - Design doc: `docs/bank-quality-indicators-design.md` — full
      sidecar JSON schema, vision-LLM extraction strategy, audit rules.
    - B5.5 (deferred): hand-curate quality_indicators.json for
      HDFC/ICICI/SBI/Kotak FY16-FY25. Vision-LLM extractor planned.
B6. 🟡 Tests cover the valuation math (18 new). End-to-end test on
    HDFC Bank fixture would be ideal next step.

### Phase C — Multi-format file routing & company auto-detect

Goal: a folder of Capitaline exports (mixed standards, mixed scopes, possibly
mixed companies) is ingested cleanly, with the company classifier choosing
the right pipeline.

C1. File-type detection: distinguish balance / pl / cf / segment / quarterly
    / standalone / investment / shareholding by both filename pattern AND
    HTML header inspection (defense in depth — Capitaline filenames
    sometimes lose the suffix on re-export).
C2. Scope policy already supports the 4-way classification. Strengthen the
    signal sets: add NBFC-specific keys ("Securitisation Receivables",
    "Off-balance Sheet Exposure"), insurance ("Solvency Margin",
    "Linked Liabilities"), real-estate ("Inventory of Land", "Real
    Estate Developed Inventory").
C3. Manual override path (`config.classificationOverride`) wired through
    UI so users can force a classification when auto-detect is wrong.
C4. Pipeline router: `industrial → PenmanNissim`, `bank → bankPipeline`,
    `nbfc → nbfcPipeline (new)`, `insurance → insurancePipeline (new,
    minimal stub)`, `mixed-financial-conglomerate → SOTP-required path`.
C5. Make `mixed-financial-conglomerate` no longer fail-closed when standalone
    + segment data is present — instead treat parent as industrial holdco
    and value financial subsidiaries via subsidiary financials (if available)
    or P/B proxy (if not).

### Phase D — NBFC pipeline (Bajaj Finance, Shriram, Muthoot)

Goal: NBFCs produce credible analysis. They differ from banks in funding
mix (no CASA), securitization, and finer asset-quality disclosure.

D1. `nbfcPipeline.ts` parallel to `bankPipeline.ts`. Reuses bank spec where
    overlap, adds AUM = on-book + off-book.
D2. Spread analysis: blended yield − blended cost of funds, leverage cap.
D3. Capital adequacy: Tier-1, CRAR, RBI minimums (15% NBFC vs 11.5% bank).
D4. Valuation: P/B Gordon + AUM multiple as cross-check.
D5. Test: Bajaj Finance fixture (any year), assert AUM growth, spread
    decomposition, capital adequacy headroom.

### Phase E — IT-services adjustments (TCS, Infosys)

Goal: treat IT companies correctly even though they look industrial. Capital
is human, not physical; the ratios that matter are different.

E1. Detector: employee_cost / revenue > 40% AND PPE / total assets < 10%
    → mark `companyType: 'it-services'`.
E2. IT-aware ratio overlay: revenue per employee, employee cost ratio,
    utilization (if disclosed), forex-hedged margin, geographic mix.
E3. Skip RNOA/PM/ATO decomposition — replace with PE + FCFE focus.
E4. Test: TCS fixture, assert rev/emp ≈ 50L/yr, employee cost 50-55%.

### Phase F — Cyclical & utility overlays

Goal: don't apply terminal-value-as-current-EPS to a cyclical at peak or a
utility on a regulated return.

F1. Cyclical detector: 5-year revenue or PAT coefficient of variation > 30%
    AND not financial → `companyType: 'cyclical'`.
F2. Wire `cyclicalNormalization.ts` into Penman-Nissim terminal value when
    cyclical (it's currently used in forecasting but not as the default
    terminal-value input for cyclicals).
F3. Utility detector: regulated-revenue keywords + capex/sales pattern.
F4. Utility overlay: cap ROE at regulated ceiling, value as RAB × allowed
    return + capex pipeline.

### Phase G — Cross-company peer & relative valuation

Goal: comparing a company to its sector becomes possible. Today
`relativeValuation.ts` is intra-company time series only.

G1. Company universe registry — JSON/SQLite indexed by symbol, sector,
    market cap. Stored at `public/data/universe.json` v1, migrate to Turso
    when count > 50.
G2. Peer group engine: by GICS-style sector + size bucket + business model.
G3. Cross-company multiples: PE, P/B, EV/EBITDA, P/Sales, ROE — sector
    medians + size-adjusted regressions.
G4. Sector-appropriate primary metric per type (P/B for banks, EV/EBITDA
    for industrials, PE for IT, P/EV for life insurance).
G5. Output: sector-positioning chart, regression-predicted fair multiple,
    z-score versus peers.

### Phase H — Quarterly + market data + monitoring

Goal: living analysis instead of point-in-time snapshot.

H1. Quarterly Capitaline parser (same dual-format HTML, different layout).
H2. NSE price feed (free public CSV from `archives.nseindia.com`) — daily
    close, volume, market cap. Cron-refreshable.
H3. Beta computation (rolling 60M vs Nifty 50).
H4. Quarterly result deviation alerts (forecast vs actual, > 1σ → flag).
H5. Shareholding pattern parser (promoter %, pledged, FII/DII trend).

### Phase I — Robustness & graceful degradation 🟡 partial

Goal: no company should make the engine throw or produce nonsense. The 5-
level data-availability ladder from the design doc must actually gate.

Shipped this session:
- `74c5f83` I1 (partial) — Capital allocation: dataSufficient/skipReason/
  profitablePeriods. Loss-makers (Paytm) and turnaround stories (Zomato)
  get explicit reasons instead of misleading composite scores.
- `d675328` Mixed-conglomerate routing override (cfg.mixed_conglomerate_route_to)
  — ICICI Bank, Reliance can be consciously routed to dominant pipeline.
- `7d7b425` Cyclicality detector — peak/trough/midcycle classification
  flags Tata Steel-style valuation distortion when latest is at extremes.

Shipped 2026-05-17 (Phases J, K, B5, I7–I10):
- Phase J1–J5: Negative net worth / negative book value fail-closed handling
  (Vodafone Idea). distressDetector.ts, equityModelsBlocked flag, V_RE_CV*
  null on negative CSE, V_ReOI kept (enterprise model), distress gates
  rigor ladder, lossMakerValuation net-debt bug fixed.
- Phase K1–K2: NBFC-specific metrics (leverage, NIM-on-advances, spread,
  debt mix) + FinancialInstitutionReport NBFC section.
- Phase B5.1–B5.4: Bank asset quality flags (see Phase B above).
- I7 ✅ Currency / unit auto-detection — `detectCurrencyUnit(grid)` scans
  for Curr. in / Currency / Unit / Denomination labels. Returns CurrencyUnit
  + multiplier. `gridToPeriods` scales to ₹ Crores at parse time.
  `RawPeriodData.currency_unit` for audit. 28 tests.
- I8 ✅ Single-period screening mode — `ScopeAssessment.screeningOnly` flag.
  Rigor ladder capped at `syntactically-valid`. Amber banner in App.tsx.
  15 tests.
- I9 ✅ Demerger / M&A structural break confirmation flow —
  `EngineConfig.excluded_periods`, `PipelineResult.structuralBreakPeriods`,
  amber banner with "Exclude pre-break periods" / "Keep all" buttons,
  slate info bar when exclusions active. 9 tests.
- I10 ✅ Load from library dropdown — 11-company dropdown in DataEntry.tsx,
  pre-built ZIPs committed to public/data/companies/, .gitignore updated.

Still to ship:
I1. (rest) Apply same skip-with-reason pattern to moat scoring on
    loss-makers (currently moat returns null on <3 periods but doesn't
    flag negative-RNOA-history outright).
I2. Audit remaining `?? 0` in valuation math; document zero-as-default
    where intentional (anomalyDetection, monteCarloWorker — these look
    correct but should be confirmed).
I3. Loss-making / early-stage path: revenue-multiple + reverse-DCF
    break-even analysis, no RE/ReOI/DCF.
I4. Negative book value handling — exclude P/B-Gordon, fall back to PE
    on normalized.
I5. Single-period upload — produce screening output only, label as
    "indicative, single-period".
I6. Demerger / M&A detection — large jump in segment / equity / revenue,
    flag as structural break.
I7. Currency / unit detection — Capitaline's `Curr. in` HTML field is
    empty in the static export (verified across all 10 sample
    companies; Capitaline only renders the unit dropdown in the live
    web view). Auto-detection from file content isn't possible. Real
    user workflow uses Cr exclusively. Documented as engine assumption;
    flag only if a user reports a discrepancy.

### Phase J — Batch + UI

Goal: 30+ companies analyzed in one run, dashboard view.

J1. Drag-drop folder ingestion (each subfolder = one company).
J2. Company-level result store with aggregate dashboard.
J3. Sector / market-cap filtering.
J4. PDF report per company.

---

## Part 3 — Likely-to-fail companies & what each one teaches us

| Company | Why it breaks today | Phase that fixes it |
|---------|--------------------| ------------------- |
| Reliance Industries | Conglomerate (energy + telecom + retail), demerger of Jio Financial → fail-closed as `mixed-financial-conglomerate` | C5 |
| Tata Steel | 15Y series spans Old GAAP + Rev VI + Ind-AS; commodity peak / trough swings break terminal value | A + F |
| Bajaj Finance | NBFC labels not in bank spec; AUM concept missing | B (groundwork) + D |
| HDFC Life | Insurance — premium / claims / EV not modelled | C2 + (future insurance pipeline) |
| Coal India | PSU utility-like; regulated tariff not modelled; cash-rich balance sheet not recognized | F |
| TCS / Infosys | Human-capital-driven; PPE-light reformulation looks anemic; ratios irrelevant | E |
| DLF / Godrej Properties | Real estate — NAV-based, project pipeline | (future Phase K) |
| Bajaj Holdings | Pure holding company — no operating business, value = sum of stakes − discount | (future Phase K) |
| Paytm | Loss-making fintech, 3Y of data, classification ambiguous | I3 + classifier override |
| Adani Ports | Infrastructure with leasehold land, lumpy capex, related-party scrutiny | F + Z (governance) |
| L&T | Multi-segment conglomerate (engineering + IT + financial subsidiary) | C5 |
| ICICI Bank | Has insurance + AMC + securities subsidiaries → mixed conglomerate | A + B + C5 |
| ONGC | Reserve-life-based, depleting asset, oil price beta | F + (future reserve-based valuation) |
| Maruti | Auto cyclical, working-capital-positive negative, royalty-heavy | F + I |
| Zomato | Loss-making, GMV-based, no positive earnings | I3 |

Common pattern: the engine is industrial-shaped. Anything not industrial
either fail-closes (financials), ignores the cycle (commodities), or
misses the value driver entirely (real estate, holdco, IT services,
insurance). Phases B-F directly address each.

---

## Part 4 — Recommended next PR

Smallest unit of work that moves the dial:

**PR 1 — Phase A1-A7 (multi-standard ingestion).**

Why first:
1. Doesn't touch any existing pipeline output. Pure ingestion expansion.
2. Required for cyclicals (15Y series) which are Phase F.
3. Required for any meaningful cross-company peer set (Phase G).
4. Cheap to validate — synthetic fixtures are sufficient before user
   downloads REV/Standard files for ITC and HDFC Bank.
5. Surface area: ~6 files (`capitalineParser.ts`, `mappingSpec.ts`, new
   `standardAliases.ts`, recast lookup, type extensions, tests).

After PR 1 ships, the user downloads Capitaline `BalanceSheetREV_.xls` /
`ProfitLossREV_.xls` / `CashFlowREV_.xls` for ITC and HDFC Bank, drops them
in the same folders, and the tool extends to FY2012 automatically.

**PR 2 — Phase B (bank mapping spec).** Cleans up `bankPipeline.ts`'s
ad-hoc key reaches and adds the three bank valuation models. Validates on
HDFC Bank then probes ICICI by asking the user for its export.

**PR 3 — Phase I (robustness pass).** No new features, just every silent
fallback in valuation math becomes an explicit skip-with-reason. Catches
the long tail of "engine produced a number that's actually garbage" cases.

PRs 4+ are Phases C / D / E / F / G / H in that order. Phase J (batch UI)
last because it depends on every company-type pipeline being stable.

---

## Part 5 — Open design questions

These need user input before execution:

Q1. **Manual classification override mechanism.** Today scope policy is
    automatic. Should overrides live in a per-company JSON file, in a
    UI form, or both? (My default: per-company JSON in
    `public/data/companies/<TICKER>/classification.json`, optional, UI
    surfaces the auto-detection and allows save-as-override.)

Q2. **External market data — how live?** Daily NSE feed via the public
    archive CSV is free and adequate. But it requires a server cron or
    a build-time data fetch. Is a daily-stale build (rebuilt at 19:00 IST
    via Vercel cron) acceptable, or do we want real-time quotes
    (subscription needed)?

Q3. **Universe size & storage.** JSON file works to ~50 companies. Beyond
    that we need SQLite (Turso edge) or Supabase. Target Nifty 50, Nifty
    100, or Nifty 500? That decides storage choice.

Q4. **Insurance & real-estate priority.** P3 in design doc. Confirm we
    skip these in Phases A-J and revisit in a Phase K, or pull them
    earlier.

Q5. **Pre-FY2012 Standard files.** They exist but coverage is patchy and
    the labels are noisier. Is going back to FY2007 worth the noise, or
    should we stop at FY2011 (Revised Sch-VI start)?

---

*Doc version 1.0 — 2026-05-17, plan mode, no code changes yet.*
