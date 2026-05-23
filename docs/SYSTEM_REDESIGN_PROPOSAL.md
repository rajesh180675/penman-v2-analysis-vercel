# System Architecture Redesign Proposal

**Date:** May 2026  
**Status:** Proposal (not yet implemented)  
**Goal:** Make the system faster, more maintainable, and scalable to 50+ companies

---

## Executive Summary

The current architecture works but has accumulated complexity debt:
- App.tsx (1,346 lines, 74 hooks) is a God Component
- No state management layer (all prop-drilled)
- localStorage as sole client persistence (5MB limit, synchronous, no compression)
- 1.35 MB gzipped initial bundle (3.5 MB raw)
- Server-side N+1 blob reads on workspace load

This proposal restructures around 4 pillars:
1. **State Architecture** — Zustand store replacing App.tsx monolith
2. **Compute Architecture** — Web Workers for pipeline, lazy engine loading
3. **Persistence Architecture** — IndexedDB + compression replacing localStorage
4. **Bundle Architecture** — aggressive code-splitting, dead code elimination

---

## 1. State Architecture — Zustand Store

### Current Problem
App.tsx manages 19 useState + 21 useMemo + 27 useEffect. Every config change triggers JSON.stringify to generate a fingerprint. Tab components receive 10+ props each.

### Proposed Solution

Replace with a Zustand store split into slices:

```
src/store/
├── index.ts              # Combined store export
├── slices/
│   ├── dataSlice.ts      # rawData, standaloneRawData, segmentData
│   ├── configSlice.ts    # EngineConfig + derived scope
│   ├── pipelineSlice.ts  # pipelineResult, recastData, bankResult
│   ├── registrySlice.ts  # CompanyRegistry, comparison state
│   ├── uiSlice.ts        # activeTab, darkMode, modals, palette
│   ├── auditSlice.ts     # auditMeta, audit trail
│   └── workspaceSlice.ts # workspace, research, shared API state
├── selectors.ts          # Memoized derived state (replaces useMemos)
└── middleware/
    ├── persist.ts        # IndexedDB persistence middleware
    └── trace.ts          # Development trace logger
```

**Key benefits:**
- Tab components subscribe only to their slice → no unnecessary re-renders
- Config changes don't cascade through 21 useMemos — derived state computed only when accessed
- No more JSON.stringify fingerprint hack — Zustand uses shallow equality by default
- App.tsx becomes ~200 lines: layout shell + router + error boundary

### Migration Path
1. Extract uiSlice (activeTab, darkMode, modals) — zero risk, no pipeline impact
2. Extract configSlice — stabilize config identity at source
3. Extract dataSlice + pipelineSlice — replace the big useMemo chain
4. Extract registrySlice + auditSlice — persistence logic moves to middleware
5. Shrink App.tsx to layout shell

---

## 2. Compute Architecture — Off-Main-Thread Pipeline

### Current Problem
`processCompanyDataFull()` runs synchronously on the main thread. For companies with 14+ years of data (Sun Pharma: 1,312 raw metrics), this blocks the UI. The existing Monte Carlo worker proves the pattern works.

### Proposed Solution

Move the full pipeline to a dedicated Web Worker:

```
src/workers/
├── pipeline.worker.ts    # processCompanyDataFull + scope assessment
├── parser.worker.ts      # capitalineParser (ZIP decompression + HTML parsing)
└── analytics.worker.ts   # v3Analytics (2,053 lines of heavy compute)
```

**Data flow:**
```
User clicks company
  → UI shows skeleton (instant)
  → parser.worker decompresses ZIP + extracts periods
  → pipeline.worker runs recast + ratios + anomaly detection
  → Store receives results → UI updates
  → analytics.worker runs v3 (fade, sensitivity, moat) in background
  → Store receives v3 results → V3 tab updates when visited
```

**Key benefits:**
- Zero main-thread blocking — UI stays responsive during pipeline
- v3Analytics (391 kB chunk) loads lazily only when the V3 tab is visited
- Parser and pipeline can run in parallel for standalone data

### Implementation Notes
- Use `comlink` for typed worker communication (6 kB, mature)
- Transferable objects for RawPeriodData arrays (zero-copy)
- Progress callbacks for long-running analyses
- Graceful fallback to main thread if workers unavailable

---

## 3. Persistence Architecture — IndexedDB + Compression

### Current Problem
- localStorage: 5-10 MB limit, synchronous, blocks startup
- Sun Pharma's registry snapshot exceeds quota
- traceLogger serializes 2 MB every 3 seconds
- No compression — raw JSON stored as-is

### Proposed Solution

Replace localStorage with IndexedDB (via `idb` library) + LZ4 compression:

```
src/persistence/
├── db.ts                 # IndexedDB schema + migrations
├── stores/
│   ├── registry.ts       # Company registry (per-company object stores)
│   ├── trace.ts          # Trace events (append-only, auto-pruned)
│   ├── workspace.ts      # Research workspace state
│   └── cache.ts          # V3 analytics cache (LRU, TTL-based)
├── compression.ts        # LZ4 compress/decompress for large payloads
└── migration.ts          # localStorage → IndexedDB one-time migration
```

**IndexedDB schema:**
```
penman-v2 (database)
├── companies (objectStore, keyPath: id)
│   └── { id, rawData, recastData, traceability, lastAccessed }
├── traces (objectStore, keyPath: id, autoIncrement)
│   └── { id, timestamp, category, event, data }
├── v3Cache (objectStore, keyPath: companyKey)
│   └── { companyKey, snapshot, timestamp, sizeBytes }
├── workspace (objectStore, keyPath: companyId)
│   └── { companyId, notebook, journal, portfolio, signals }
└── config (objectStore, keyPath: key)
    └── { key: "engineConfig", value: {...} }
```

**Key benefits:**
- 100+ MB storage (vs 5 MB localStorage)
- Asynchronous — never blocks main thread
- Per-company object stores — no "serialize everything" bottleneck
- Auto-pruning: traces > 7 days deleted, v3Cache LRU at 50 MB cap
- One-time migration reads localStorage → writes IndexedDB → clears old keys

### Compression Strategy
- Raw data > 100 KB: compress with LZ4 before storing
- Typical compression: 3-5x on JSON financial data
- Sun Pharma (currently fails at ~4 MB): stores as ~800 KB compressed

---

## 4. Bundle Architecture — Aggressive Code Splitting

### Current Problem
- Initial load: 337 kB main + 193 kB React + 361 kB charts = 891 kB before any tab
- vendor-file-parsing (1,034 kB) loaded on import even though parsing only happens on data upload
- @faker-js/faker, express, cors in production deps
- Test fixtures ship in production build

### Proposed Solution

**Phase A — Dependency cleanup:**
```diff
# Move to devDependencies (never needed in client bundle):
- @faker-js/faker
- express
- cors
- jsdom

# Remove from manualChunks (should never be in prod):
- engine-golden-suite
```

**Phase B — Lazy loading everything except the shell:**
```
Initial load (target: <200 kB gzipped):
  ├── React + React-DOM (60 kB gzip)
  ├── App shell + tab bar + CompanyLibraryGrid (~80 kB gzip)
  └── Zustand store + routing (~10 kB gzip)

On first data load:
  ├── capitalineParser (lazy import) — only when ZIP dropped/selected
  └── pipeline engine (via worker, separate chunk)

Per-tab (on navigation):
  ├── Statements tab: RecastStatements + table components
  ├── Ratios tab: RatioReport + Recharts (charts loaded on first chart tab)
  ├── Valuation tab: ValuationReport + sensitivity charts
  ├── Bank tab: FinancialInstitutionReport
  ├── V3 tab: v3Analytics (391 kB) + V3AnalyticsPanel
  ├── Export: jspdf + html2canvas + exceljs (only on "Export" click)
  └── ... (all other tabs already lazy)
```

**Phase C — Recharts → lightweight alternative for simple charts:**
Recharts (361 kB) is used for 18 charts but most are simple line/bar charts. Consider:
- Keep Recharts only for complex charts (waterfall, tornado, heatmap)
- Use lightweight `uplot` (35 kB) or `lightweight-charts` for time-series
- Or keep Recharts but load it only on first chart-tab navigation

**Expected result:**
- Initial load: ~150 kB gzipped (from 891 kB)
- Time to Interactive: <1.5s (from ~4s)
- Per-company analysis: perceived instant (worker runs in background)

---

## 5. Server Architecture Improvements

### Current Problem
- N+1 blob reads: listJsonBlobs fetches each blob individually
- Pretty-printed JSON (30-40% size inflation)
- No response caching headers

### Proposed Solution

**A. Batch reads:**
Replace N+1 pattern with a single "workspace manifest" blob per company:
```json
// research-store/companies/{id}/manifest.json
{
  "profile": { ... },
  "filings": [...],
  "valuations": [...],
  "journal": [...],
  "lastModified": "2026-05-23T..."
}
```
One read instead of 400+. Client sends `If-Modified-Since` → 304 when unchanged.

**B. Compact JSON:**
```diff
- JSON.stringify(payload, null, 2)
+ JSON.stringify(payload)
```
Saves 30-40% on stored blob size and transfer.

**C. Edge caching:**
Add `Cache-Control: public, max-age=60, stale-while-revalidate=300` to GET responses. Registry data doesn't change every second.

---

## 6. Engine Module Decomposition

### Current Problem
3 files > 1,400 lines each. Circular dependency workarounds (inline function duplication).

### Proposed Decomposition

```
src/engine/
├── pipeline.ts                    # 328 lines — KEEP (orchestrator, already clean)
├── recast/
│   ├── index.ts                   # Re-exports
│   ├── balanceSheet.ts            # BS recast logic (from PenmanNissimEngine)
│   ├── incomeStatement.ts         # IS recast logic
│   ├── cashFlow.ts                # CF recast logic
│   └── metricResolution.ts        # Fuzzy key matching, composite key parsing
├── ratios/
│   ├── penmanRatios.ts            # RNOA, PM, ATO, FLEV, SPREAD, NBC
│   ├── residualIncome.ts          # V_RE, V_ReOI computation
│   ├── qualityMetrics.ts          # Earnings quality signals
│   └── kwDerivation.ts            # Structural kw from WACC
├── valuation/
│   ├── v3Orchestrator.ts          # Top-level v3 entry point (~200 lines)
│   ├── fadeEstimation.ts          # Phi estimation, persistence half-lives
│   ├── terminalValue.ts           # Terminal anchoring, TV grades
│   ├── sensitivityMatrix.ts       # ke × g sensitivity grids
│   ├── confidenceScoring.ts       # Composite confidence model
│   └── eventDetection.ts          # Triggers, anomalies, regime changes
├── bank/                          # Already clean — bankPipeline.ts + bankValuation.ts
├── detection/                     # Already clean — distress, cyclicality, IT-services
└── scoring/                       # Already clean — moat, capital allocation
```

**Migration:** Extract one module at a time. Each extraction = 1 PR with tests passing. PenmanNissimEngine.ts → recast/ + ratios/. v3Analytics.ts → valuation/.

---

## Implementation Priority

| Phase | Effort | Impact | Risk |
|-------|--------|--------|------|
| 4A: Dep cleanup + dead code removal | 1 day | Medium (150 kB saved) | Zero |
| 1.1: Extract uiSlice from App.tsx | 2 days | Medium (cleaner code) | Low |
| 3: IndexedDB migration | 3 days | High (no quota errors, faster startup) | Low |
| 4B: Lazy-load charts + parser | 2 days | High (initial load 150→100 kB) | Low |
| 2: Pipeline Web Worker | 4 days | High (zero UI blocking) | Medium |
| 1.2-1.5: Full Zustand migration | 5 days | Very High (maintainability) | Medium |
| 5: Server manifest pattern | 2 days | Medium (workspace load 10x faster) | Low |
| 6: Engine decomposition | 5 days | Medium (maintainability) | Low |

**Total: ~24 days of focused work for a complete architecture overhaul.**

---

## What NOT to Change

- **Pipeline determinism** — the Sort → Recast → Ratios → Anomaly → Quality sequence is correct
- **Rigor ladder** — the 5-level trust gate system is architecturally sound
- **Trust envelope** — shared confidence signal across tabs works well
- **Lazy tab loading** — 16 components already lazy-loaded (extend, don't replace)
- **Deterministic ZIP generation** — the sync-companies pattern is solid
- **Type system** — 826 tests + strict TypeScript provide good guardrails
- **Build validation** — typecheck + test + build CI gate is correct

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Initial load (gzipped) | 891 kB | <200 kB |
| Time to Interactive | ~4s | <1.5s |
| Pipeline execution (main thread) | 200-500ms blocking | 0ms (worker) |
| App.tsx lines | 1,346 | <200 |
| localStorage quota errors | Frequent (Sun Pharma) | Zero |
| Startup parse blocking | 100-300ms | 0ms (async IndexedDB) |
| Server workspace load | 400+ blob reads | 1 read |
