# Master Architecture & Implementation Plan: Penman V2.0

> **Date:** 2026-04-06  
> **Source:** Synthesis from 4 parallel research agents — 3,101 lines of brainstorming across Penman-Nissim methodology, valuation theory, architecture/schema, and ITC business case analysis.  
> **Goal:** Make the system unassailable in financial theory, defensible under review, and architecturally scalable to 1,000+ companies with 10,000+ labels each.

---

## 0. Executive Summary

The current Penman V2 system is a sophisticated, well-architected implementation of the Nissim & Penman (2001) framework. The recasting logic, ratio computation, residual earnings derivation, valuation triangulation (RE/ReOI/FCFF/FCFE/AEG/DDM), and rigor ladder are fundamentally sound.

**Four critical gaps emerged:**

| # | Gap | Severity | Impact |
|---|-----|----------|--------|
| 1 | **OLLEV decomposition doesn't close** — RNOA_check ≠ RNOA | High | Undermines core Penman identity |
| 2 | **AR(1) phi estimated but unused in terminal value** | High | Forecast fade is disconnected from CV |
| 3 | **No growth accounting** — can't separate value from growth vs. existing assets | High | No defensible growth vs. no-growth split |
| 4 | **Mapping spec covers 3.8% of ITC data** | High | 96.2% of signal left on the table |

**Six strategic gaps:** SOTP for conglomerates, server-side computation, proper database architecture, India-specific quality signals, multi-tenant workspace design, reverse DCF expansion.

---

## Phase 1: Quick Wins — Mathematical Fixes (Week 1-2)

### 1.1 Fix OLLEV Decomposition Closure

**Problem:** RNOA_check = ROOA + OLLEV_OA × OLSPREAD doesn't equal RNOA because:
- OL imputed interest uses risk-free rate (too high for trade payables)
- OL is conflated between "free OL" (trade payables, deferred revenue) and "interest-bearing OL" (pensions, lease payables)

**Fix:**
```typescript
// Split OL into two categories
const freeOL = OL_components.trade_payables 
  + OL_components.other_current_liabilities 
  + OL_components.provisions_current;

const interestBearingOL = PensionObl 
  + lease_payables_imputed 
  + other_financing_like_OL;

// Compute ROOA without imputed interest on free OL
const ROOA = OI / avg(OA);

// Correct OLLEV decomposition
const OLLEV = avg(freeOL) / avg(NOA);
const OLSPREAD = ROOA - 0; // Free OL has ~0 implicit rate
RNOA_check = ROOA + OLLEV * OLSPREAD; // Must close

// Report interestBearingOL separately as a financing proxy
```

**Files:** `src/engine/PenmanNissimEngine.ts` (~line 630-650)  
**Tests:** Add identity test: `Math.abs(RNOA - RNOA_check) < 0.001`

### 1.2 Use AR(1) Phi in Terminal Value

**Problem:** `estimateFadeParams()` computes phi for PM, ATO, Sales Growth but the CV uses a Gordon growth perpetuity that ignores phi.

**Fix — Add reversion-based CV:**
```typescript
// Ohlson (1995) linear information dynamics terminal value
// CV_reversion = RE_T * phi / (1 + ke - phi)
// This is more defensible than Gordon growth when g is uncertain
const phi_re = estimateArPhiOnRE(reSeries); // AR(1) on RE series directly
const cvReversion = RE_T * phi_re / (1 + ke - phi_re);

// Report both:
// - CV_gordon: the perpetuity (current)
// - CV_reversion: the AR(1) reversion (new)
// - Flag when they diverge by > 20%
```

**Files:** `src/engine/v3Analytics.ts`, `src/engine/PenmanNissimEngine.ts`  
**Tests:** Compare CV_gordon vs. CV_reversion for VST, NETCASH_CONSUMER, LEVERAGED_INDUSTRIAL

### 1.3 Add Growth Accounting Decomposition

**Problem:** System reports TV% but never shows how much value comes from growth vs. no-growth.

**Fix:**
```typescript
// No-growth value (Penman's preferred anchor)
const noGrowthValue = CSE0 + (RNOA_T - kw) * NOA_T / kw;

// Growth value
const growthValue = totalValue - noGrowthValue;
const growthFraction = growthValue / totalValue;

// Report: "X% of value from reinvestment and growth, Y% from existing assets"
```

**Files:** `src/engine/PenmanNissimEngine.ts`, `src/components/ValuationReport.tsx`  
**UI:** Add growth accounting bar chart alongside TV grade.

### 1.4 Fix FCFE Definition Under Dirty Surplus

**Problem:** FCFE = CNI - dCSE is correct only under clean surplus. Diverges from cash-based FCFE when dirty surplus exists.

**Fix:**
```typescript
const FCFE_cash = CFO - Capex + netBorrowing;
const FCFE_accrual = CNI - dCSE;
const FCFE_divergence = Math.abs(FCFE_cash - FCFE_accrual);
// Flag when divergence > 5% of equity value
```

---

## Phase 2: Methodology Expansion (Week 3-4)

### 2.1 Reverse DCF Module

**Scope:** Full reverse DCF engine that solves for what the market is pricing in.

```typescript
interface ReverseDCFResult {
  impliedGrowth: number;       // What growth justifies current price?
  impliedTerminalROIC: number; // What terminal ROIC does the market assume?
  impliedKE: number;           // What cost of equity is priced in?
  narrativeSpace: NarrativeBand; // Set of plausible (g, ROIC) pairs
  marketExpectationLabel: string; // "Growth priced in", "Value trap", etc.
}
```

**For ITC:** The market prices in ~6% growth with ~25% terminal ROIC. The engine should flag this.

### 2.2 SOTP Framework for Conglomerates

**Scope:** Multi-segment valuation architecture. Start with manual segment definition, evolve to auto-detection.

```typescript
// Phase 2: Manual SOTP
interface SegmentDefinition {
  name: string;
  revenuePct: number;
  operatingProfitPct: number;
  allocatedNOA: number;
  sectorTemplate: ValuationSectorTemplate;
  terminalGrowthOverride?: number;
  fadeSpeedOverride?: number;
}

// For ITC:
// Cigarettes: 60% EBIT, consumer-staples, high PM, low growth
// FMCG-Others: 20% EBIT, consumer-staples, moderate PM, higher growth  
// Agribusiness: 10% EBIT, commodities
// Hotels: 5% EBIT, cyclical/services
// Paperboard/Packaging: 5% EBIT, industrials

// Conglomerate discount: 5-12% for India (empirical)
const conglomerateDiscount = estimateConglomerateDiscount(segments);
```

### 2.3 India-Specific Quality Signals

Add these metrics to quality scoring:
- **Promoter holding change** (increasing = positive signal in Indian market)
- **RPT (Related Party Transaction) intensity** (high = governance risk)
- **Corporate governance events** (auditor changes, qualified opinions)
- **Tax avoidance intensity** (effective rate vs. statutory — matters for India's MAT regime)
- **Pledge of promoter shares** (critical Indian market governance signal)

### 2.4 EV/EBITDA Cross-Check

Already have EBITDA in recast output. Add:
```typescript
// Compute sector-appropriate EV/EBITDA multiples from peer universe
const evEbitdaMedian = peerMultipleMedian('EV/EBITDA', sector);
const evEbitdaP25 = peerMultiplePercentile('EV/EBITDA', 25, sector);
const evEbitdaP75 = peerMultiplePercentile('EV/EBITDA', 75, sector);

// Apply multiples
const evFromMedian = EBITDA_T * evEbitdaMedian;
const equityFromMultiple = evFromMedian - NFO;
```

---

## Phase 3: Architecture & Scalability (Month 2-3)

### 3.1 Three-Tier Mapping Ontology

**Problem:** 180 labels → 3,234 labels gap.

**Solution:**
```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Canonical Spine (~180 keys — curated)          │
│   Hand-verified, statement-aware, exact/fuzzy match     │
│   → Core Penman recasting runs on these                 │
├─────────────────────────────────────────────────────────┤
│ Layer 2: Auto-Discovery Index (auto-populated)          │
│   Every unknown label is indexed by pattern matching    │
│   Statement tag, numeric type, first-seen period,       │
│   non-zero frequency, correlation with known labels     │
│   → Powers the backlog-preview UI                       │
├─────────────────────────────────────────────────────────┤
│ Layer 3: Pattern-Based Expansion (auto-generated)       │
│   Clustering engine groups similar unknown labels       │
│   e.g., "Trade Receivables > 6 months" → maps to       │
│   existing "Trade Receivables" canonical key            │
│   → Suggests mapping spec additions                     │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Hybrid Compute Model

| Layer | Current | Proposed |
|-------|---------|----------|
| Parsing | Client-side | Keep client (ZIP/HTML processing) |
| Mapping | Client-side | Keep (fast lookup) |
| Recasting | Client-side | **Serverless function** (api/compute) |
| Valuation | Client-side | **Serverless + Web Worker** (parallel) |
| Monte Carlo | Web Worker | Keep |
| Storage | Vercel Blob | **Database (Turso/LiteFS or Neon)** |

**Why server-side recasting:**
- Reproducibility: same input → same recast, always verifiable
- Pre-computation: cache recast results for all golden companies
- API-first: external systems can query pre-computed recast data
- Performance: large datasets (48,510+ points) don't block the UI

### 3.3 Database Schema Design

```sql
-- Core entities
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  legal_name TEXT,
  ticker TEXT,
  exchange TEXT,
  sector TEXT,
  sub_sector TEXT,
  support_status TEXT,
  created_at TEXT
);

CREATE TABLE raw_imports (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  source TEXT,  -- 'capitaline', 'screener', 'xbrl', 'json', 'manual'
  raw_data JSONB,
  parser_diagnostics JSONB,
  parser_fidelity_score REAL,
  imported_at TEXT
);

CREATE TABLE recast_runs (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  raw_import_id TEXT REFERENCES raw_imports(id),
  schema_version TEXT,
  policy_versions JSONB,
  recast_data JSONB,
  traceability JSONB,
  rigor_level TEXT,
  mapping_coverage JSONB,
  computed_at TEXT,
  config JSONB
);

CREATE TABLE valuations (
  id TEXT PRIMARY KEY,
  recast_run_id TEXT REFERENCES recast_runs(id),
  valuation_data JSONB,  -- RE, ReOI, FCFF, FCFE, AEG results
  terminal_anchor TEXT,
  fade_params JSONB,
  growth_accounting JSONB,
  computed_at TEXT
);

CREATE TABLE comparison_registry (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  company_ids JSONB,
  snapshot JSONB,
  schema_version TEXT,
  created_at TEXT,
  UNIQUE(workspace_id)
);
```

### 3.4 Performance Improvements

1. **Web Workers for pipeline:** The recasting + ratio + quality + valuation pipeline runs on a worker thread, not blocking React render
2. **Virtualization for large tables:** Use `@tanstack/react-virtual` for the 922 Balance Sheet labels table
3. **Structured clone optimization:** Transfer recast results via `postMessage` with transferable objects
4. **Memoized selectors:** Use `reselect` more aggressively on the 48,510 data points
5. **Lazy loading:** Split the advanced analytics chunk further — don't load Monte Carlo unless user clicks it

---

## Phase 4: Conglomerate & India-Specific (Month 4)

### 4.1 ITC-Specific: Handle Structural Events

The current engine correctly identifies ITC as blocked but doesn't explain *why* adequately:

**FY2025 Discontinued Operations (15.0B):** Engine should:
- Isolate continuing ops from discontinuing ops in the recast
- Recast IS: separate core OI from discontinued contribution
- Adjust terminal growth and fade for the continuing business only

**FY2021 Special Dividend (18.9B):**
- Flag as non-recurring capital return
- Adjust dividend sustainability analysis
- Don't use FY2021 CFO/Div ratio for payout sustainability

### 4.2 India-Specific Regime Overlays

```typescript
interface IndiaRegimeOverlay {
  cigaretteExciseDutyChanges: Array<{year: string; impact: number}>;
  corporateTaxRateCut2019: { oldRate: number; newRate: number; effectiveFrom: string };
  indAS116Transition: { period: string; impact: { roa: number; dToE: number } };
  gstImplementation2017: { workingCapitalImpact: 'positive' | 'negative' };
  demonetization2016: { revenueImpact: string };
}
```

### 4.3 Segment Disclosure Mapping

For Indian companies with segment reporting (Ind AS 108):
- Extract segment revenue, operating profit, and segment assets
- Map each segment to a Penman valuation model
- Compute SOTP value with appropriate discounts

---

## Phase 5: Quality & Polish (Month 5+)

### 5.1 Earnings Quality Scorecard

Based on Dechow et al. (2010) framework:
1. **Recognition timeliness** (how fast earnings reflect economic events)
2. **Neutrality** (conservative vs. aggressive accounting)
3. **Completeness** (comprehensive income vs. dirty surplus)
4. **Realization** (cash backing of accruals)

### 5.2 Dechow-Dichev Accrual Quality

```typescript
// Regress working capital accruals on current, lag, and lead CFO
// R² of this regression measures earnings quality
// Low R² = high accrual noise = low earnings quality
```

### 5.3 Real Earnings Management Tests (Roychowdhury 2006)

Detect abnormal discretionary expenses, abnormal production costs, and abnormal CFO.

### 5.4 Feltham-Ohlson Conservative Accounting Adjustment

Estimate conservatism degree and adjust terminal value upward for conservatively accounted firms.

---

## Priority Matrix

| Priority | Impact | Effort | Items |
|----------|--------|--------|-------|
| **P0 — Do Now** | High | Low | 1.1 OLLEV fix, 1.2 AR(1) CV, 1.3 Growth Accounting |
| **P1 — Short Term** | High | Medium | 2.1 Reverse DCF, 2.3 India Quality Signals, 2.4 EV/EBITDA |
| **P2 — Medium Term** | High | High | 3.1 Mapping Ontology, 3.2 Hybrid Compute, 3.3 Database Schema |
| **P3 — Strategic** | High | High | 4.1 ITC Structural Events, 4.2 India Regime, 4.3 SOTP |
| **P4 — Nice to Have** | Medium | High | 5.1 Earnings Scorecard, 5.2 Dechow-Dichev, 5.3 Earnings Management |

---

## Key Metrics Post-Implementation

| Metric | Current | Target (V2.0) |
|--------|---------|----------------|
| Mapping coverage (ITC) | 3.8% (122/3,234) | >60% (~2,000+) |
| OLLEV closure | Broken | Within 0.1% |
| Terminal value methods | 1 (Gordon) | 3+ (Gordon, Reversion, ROIC-converged) |
| Growth accounting | Absent | Present for all methods |
| Conglomerate support | None | Manual SOTP → auto SOTP |
| Server-side compute | None | Recasting + valuation cached |
| Database | Vercel Blob (JSON) | Relational with JSONB |
| Quality signals | 5 classical | 10+ (incl. India-specific) |
| Monte Carlo convergence | Manual | Auto-check with Gelman-Rubin |
| Cross-sectional peer checks | Basic | Full relative valuation matrix |

---

## Files to Create/Modify (Summary)

### New files:
- `src/engine/growthAccounting.ts` — Growth vs. no-growth decomposition
- `src/engine/reverseDcf.ts` — Reverse DCF solver (growth, ROIC, KE)
- `src/engine/earningsQuality.ts` — Dechow-Dichev, Roychowdhury tests
- `src/engine/sotp.ts` — Sum-of-the-parts framework
- `src/engine/indiaRegime.ts` — India-specific regime overlay
- `src/engine/persistence.ts` — AR(1) on RE/ReOI directly
- `src/engine/ollevCorrector.ts` — OLLEV decomposition closure
- `src/engine/mappingOntology.ts` — Three-tier label mapping engine
- `src/lib/mappingBacklogPolicy.ts` — Backlog-driven mapping suggestions
- `api/compute/index.ts` — Serverless recasting endpoint

### Modified files:
- `src/engine/PenmanNissimEngine.ts` — OLLEV fix, growth accounting, persistence
- `src/engine/v3Analytics.ts` — AR(1) phi integration in CV, growth accounting
- `src/engine/Pipeline.ts` — Worker thread support
- `src/engine/ValuationPolicy.ts` — New valuation methods registration
- `src/components/ValuationReport.tsx` — Growth accounting UI, reverse DCF panel
- `src/components/ForecastReport.tsx` — Conglomerate segment cards
- `CapitalineIndASDetailedMappingSpec.yaml` — 180 → 2,000+ label expansion

---

## Appendix: What All 4 Research Agreed On

1. **OLLEV is broken** — must fix, it's a Penman identity
2. **Phi is wasted** — estimated in forecast fade, unused in terminal value
3. **Conglomerates need SOTP** — treating ITC as a single business is fundamentally wrong
4. **Mapping spec needs to go** — from 180 to 2,000+ labels with auto-discovery
5. **Server-side compute is inevitable** — client can't scale to 1,000 companies
6. **India-specificity matters** — tax regimes, governance signals, tobacco regulation
7. **Growth accounting is the missing narrative piece** — "What am I really paying for?"
