# Architecture Analysis and Redesign Brainstorm

**Date**: 2026-04-06
**Context**: Penman V2 Analysis — React + Vite SPA on Vercel
**Scope**: 10-axis analysis covering data model, compute, mapping, traceability, rigor, performance, multi-tenant, API, testing, and deployment.

---

## 0. Executive Summary

The current architecture is a well-engineered client-side financial analysis tool with a rigorous traceability envelope and a fail-closed rigor ladder. However, it faces systemic scaling constraints:

- **All 48,510 data points** (3,234 labels x 15 periods) flow through the browser's single-threaded JS runtime.
- **Blob storage** acts as a key-value store with no indexing, no multi-tenant isolation, and no query capability.
- **Mapping coverage** is 3.8% of observed raw labels (122 out of 3,234), making every new company a manual mapping exercise.
- **The serverless API** is a blob-backed POST/GET router with no schema validation, no pagination, and no access control.

Below are concrete proposals, ordered by impact-to-effort ratio.

---

## 1. Data Model Redesign

### 1.1 Current Storage Architecture

The current system uses `@vercel/blob` as a dumb key-value store:

```
research-store/companies/{companyId}/profile.json
research-store/companies/{companyId}/filings/{timestamp}.json
research-store/companies/{companyId}/valuations/{timestamp}.json
research-store/companies/{companyId}/analysis/{timestamp}.json
research-store/companies/{companyId}/journal/{timestamp}.json
research-store/companies/{companyId}/alerts/{timestamp}.json
research-store/comparison-registry/latest.json
```

Problems:
- No relational queries (can't find "all companies with production-ready status").
- No versioning of raw period data snapshots.
- No workspace-level partitioning.
- Every read requires listing all blobs and deserializing payloads.
- Blob storage costs scale with every write; there is no dedup or reference model.

### 1.2 Proposed Schema for a Proper Database

Use **Neon** (serverless Postgres, first-class Vercel integration) or **Turso** (serverless libSQL via Vercel Marketplace). Both offer connection pooling, which Vercel serverless functions require.

```sql
-- ===== Workspaces =====
CREATE TABLE workspaces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  owner_id      TEXT NOT NULL,           -- Vercel team / auth subject
  created_at    TIMESTAMPTZ DEFAULT now(),
  settings      JSONB NOT NULL DEFAULT '{}'
);

-- ===== Companies =====
CREATE TABLE companies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  external_id   TEXT NOT NULL,            -- e.g. "ITC", ticker
  label         TEXT NOT NULL,
  sector        TEXT,                     -- "FMCG", "Auto", etc.
  scope_class   TEXT,                     -- from scopePolicy
  tier          TEXT,                     -- "Tier 1" | "Tier 2" | "Tier 3"
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, external_id)
);
CREATE INDEX idx_companies_workspace ON companies(workspace_id);

-- ===== Raw Data Periods =====
CREATE TABLE raw_periods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_end      DATE NOT NULL,
  metric_values   JSONB NOT NULL,         -- raw_metric_values
  source_file     TEXT,
  source_mode     TEXT NOT NULL,          -- "capitaline" | "screener" | "xbrl" | "manual"
  parser_diag     JSONB,
  UNIQUE(company_id, period_end, source_mode)
);
CREATE INDEX idx_raw_periods_company ON raw_periods(company_id);

-- ===== Recast Runs =====
CREATE TABLE recast_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  engine_version  TEXT NOT NULL,          -- e.g. "v2-final"
  config_hash     TEXT NOT NULL,          -- SHA-256 of EngineConfig
  config          JSONB NOT NULL,         -- full EngineConfig
  status          TEXT NOT NULL,          -- "syntactically-valid" | "structurally-reconciled" | ...
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_recast_runs_company ON recast_runs(company_id);

-- ===== Per-Period Recast Results =====
CREATE TABLE recast_periods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES recast_runs(id) ON DELETE CASCADE,
  period_end      DATE NOT NULL,
  balance_sheet   JSONB NOT NULL,
  income          JSONB NOT NULL,
  cash_flow       JSONB NOT NULL,
  core_unusual    JSONB NOT NULL,
  ratios          JSONB,
  residual_income JSONB,
  quality         JSONB,
  trace_map       JSONB,
  spec_flags      JSONB,
  UNIQUE(run_id, period_end)
);

-- ===== Traceability Envelopes (stored per run for replay) =====
CREATE TABLE traceability_envelopes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES recast_runs(id) ON DELETE CASCADE,
  schema_version  TEXT NOT NULL,          -- "2026-04-traceability-v8"
  envelope        JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ===== Valuation Results =====
CREATE TABLE valuations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  run_id          UUID REFERENCES recast_runs(id),
  method          TEXT NOT NULL,          -- "RE" | "ReOI" | "FCFF" | "FCFE" | "AEG"
  result          JSONB NOT NULL,
  ke              NUMERIC,
  g_terminal      NUMERIC,
  scenario        TEXT,                   -- "base" | "bull" | "stress"
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_valuations_company ON valuations(company_id);

-- ===== Comparison Sets =====
CREATE TABLE comparison_sets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE comparison_set_members (
  set_id          UUID NOT NULL REFERENCES comparison_sets(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  run_id          UUID REFERENCES recast_runs(id),
  PRIMARY KEY (set_id, company_id)
);

-- ===== Mapping Backlog (persistent, shared across workspace) =====
CREATE TABLE mapping_backlog (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID REFERENCES workspaces(id),  -- NULL = global / community
  source_mode     TEXT NOT NULL,
  raw_label       TEXT NOT NULL,
  statement       TEXT,
  periods_seen    INTEGER DEFAULT 1,
  non_zero        INTEGER DEFAULT 0,
  latest_value    NUMERIC,
  max_abs_value   NUMERIC,
  triage_action   TEXT,                 -- "add-to-spec" | "group-to-existing" | "ignore-non-core" | "review"
  triage_priority TEXT,                 -- "blocking" | "diagnostic" | "optional"
  spec_path       TEXT,                 -- suggested path in mapping spec
  decided_by      TEXT,
  decided_at      TIMESTAMPTZ,
  UNIQUE(workspace_id, source_mode, raw_label, statement)
);
```

### 1.3 Data Size Estimates

| Entity | Size per Row | Est. Rows (6 companies, 15 periods) | Total |
|--------|-------------|--------------------------------------|-------|
| raw_periods | ~50 KB (JSONB with 3,234 keys) | 90 | 4.5 MB |
| recast_periods | ~10 KB (canonical types) | 135 (2 runs per company) | 1.4 MB |
| traceability | ~8 KB | 6 | 48 KB |
| valuations | ~15 KB | 30 (5 methods x 6 companies) | 450 KB |

A Neon Postgres free tier (1 GB storage, 5 GB/month bandwidth) easily handles the first 50 companies. Cost at medium tier: ~$8/month.

### 1.4 Migration Path

**Phase 1 (dual-write)**: Continue writing blobs while also writing to the new database. The `api/research/index.js` endpoint becomes an adapter that writes to both stores.

**Phase 2 (read from DB)**: Switch reads to the relational store. Blob reads become fallback only.

**Phase 3 (deprecate blob)**: Remove blob writes entirely. Keep blob for static assets (uploaded XML/PDF originals) if needed.

---

## 2. Server-Side Computation

### 2.1 Current State

The pipeline in `src/engine/pipeline.ts` (~90 lines) is deterministic, synchronous, and runs entirely in the browser:

```
sorted data -> recast (per period) -> ratios/kw/RI/quality -> anomaly detection
```

For 15 periods, each with 3,234 raw keys, the per-period recast traverses the entire mapping spec (~180 keys) plus composites. Ratios operate on the already-reduced canonical types (~25 ratio calculations per period from period 2 onward).

### 2.2 Cost-Benefit of Server-Side Compute

**Arguments for server-side**:
- Consistent, auditable compute versions (no "client version X vs client version Y" variance).
- Eliminates cold-start latency for returning users — results are pre-computed.
- Enables background runs (e.g., re-run all companies when engine version changes).
- Reduces client bundle by moving ~93 engine files off the critical path.
- Multi-company comparison could be done server-side without transferring 48,510 data points per company.

**Arguments against**:
- The engine is already deterministic; client-side reproducibility is defensible.
- Serverless cold starts (200–1500ms) would add latency for interactive config changes (tax rate, OCI treatment).
- Current bundle is manageable with code-splitting (golden test suite, analytics chunk).

### 2.3 Recommendation: Hybrid Compute Model

**Recast pipeline stays client-side** (users change config params interactively and need instant feedback). But:

1. **Add a server-side "pin" endpoint** (`POST /api/research/{companyId}/pin-run`): Serializes the current `recastData[]` and `traceability` envelope to the database. This gives audit-trail reproducibility without changing the interactive model.

2. **Serverless function for batch operations** (`POST /api/research/batch-compare`): Accepts a list of `companyId`s, loads raw data + recast runs from the database, computes a comparison summary server-side, returns only the comparative result (not 48K points per company).

3. **Edge cache for pre-computed analysis**: Using Vercel's `stale-while-revalidate` on `GET /api/research/{companyId}/latest-recast`, cache the latest pinned run for 1 hour. First user to open a company after a cold cache gets the server-computed result (~500ms cold start), subsequent users get it instantly.

```typescript
// api/research/[companyId]/latest-recast/route.ts (Vercel serverless function)
import { Redis } from "@upstash/redis";

const kv = new Redis();

export default async function handler(req, res) {
  const { companyId } = req.query;
  const cacheKey = `recast:${companyId}:latest`;
  const cached = await kv.get(cacheKey);
  if (cached) {
    res.setHeader("x-vercel-cache", "HIT");
    res.status(200).json(cached);
    return;
  }

  // Load from DB, compute traceability summary, cache
  const result = await computeLatestRecast(companyId);
  await kv.set(cacheKey, result, { ex: 3600 });
  res.setHeader("x-vercel-cache", "STALE");
  res.status(200).json(result);
}
```

---

## 3. Mapping Spec Architecture

### 3.1 Current State

The `CapitalineIndASDetailedMappingSpec.yaml` (~200 lines) maps ~180 canonical keys to their raw Capitaline label aliases. With ITC producing 3,234 unique raw labels per period, this covers only ~122 labels (3.8%). The remaining ~3,112 labels go into the mapping backlog.

The mapping resolution chain is:
1. TypeScript mapping spec (`src/engine/mappingSpec.ts`) — primary source.
2. YAML spec (`CapitalineIndASDetailedMappingSpec.yaml`) — auditable declaration.
3. Backlog policy (`mappingBacklogPolicy.ts`) — rule-based triage for out-of-spec labels.
4. Resolution tiers (A/B/C/D) in `mappingPolicy.ts`.

### 3.2 Scaling to 3,000+ Labels: Three-Tier Ontology

**Problem**: Manually adding ~3,000+ labels to a YAML file is unsustainable. Each new company may introduce 50–200 new labels.

**Solution**: A hierarchical ontology with three layers:

#### Layer 1: Canonical Spine (curated, ~180 keys — stays the same)
These are the Penman-Nissim canonical keys (TA, CSE, Sales, CFO, etc.). Manually curated, high-confidence, auditable. These map to the recast types.

```yaml
canonical:
  bs.ta:
    type: total
    statement: BalanceSheet
    aliases: ["Total Assets"]
    composite_of: null  # Top-level total
    tier: A

  bs.fa.cash_bank:
    type: composite
    statement: BalanceSheet
    aliases: []
    composite_of:
      - bs.fa.cash_equivalents
      - bs.fa.bank_balances_other
      - bs.fa.earmarked_balances
      - bs.fa.margin_money
    tier: D  # Derived
```

#### Layer 2: Auto-Discovery Index (auto-populated, schema-driven)
A database-backed index that accumulates all observed raw labels across all companies, with fuzzy-matching suggestions against Layer 1 and Layer 3.

```sql
CREATE TABLE label_ontology (
  id              UUID PRIMARY KEY,
  canonical_key   TEXT REFERENCES canonical_keys(key),
  raw_label       TEXT NOT NULL,
  source          TEXT NOT NULL,        -- "capitaline" | "screener" | "xbrl"
  resolution_tier TEXT,                 -- A | B | C | D
  confidence      NUMERIC DEFAULT 0,
  match_method    TEXT,                 -- "exact" | "fuzzy" | "pattern" | "llm_suggested"
  companies_seen  UUID[],              -- which companies produced this label
  first_seen      TIMESTAMPTZ,
  last_verified   TIMESTAMPTZ,
  verified_by     TEXT,                 -- "human" | "rule" | "ml"
  UNIQUE(raw_label, source)
);
```

#### Layer 3: Pattern-Based Discovery (auto-generated from backlog)
Instead of manually adding each label, define high-confidence patterns that capture families of labels.

```typescript
// Instead of hardcoding:
// - "Advertisement, Marketing and Business Development"
// - "Advertisements"
// - "Advertisement and Sales Promotion"

// Use an ontology pattern:
{
  canonical_group: "bs.ol_components.other_current_liabilities",
  patterns: [
    { regex: /trade advance|advance.*customer|credit balance/i, confidence: 0.85 },
    { regex: /security deposit|deposit.*refundable|margin money/i, confidence: 0.90 },
  ],
  // Automatically labels any Capitaline label matching these patterns
}
```

### 3.3 ML-Assisted Suggestion Pipeline (Phase 3)

```
New raw label
  → Exact match in label_ontology? → YES → use it
  → Pattern match? → YES → score confidence → if >0.8, auto-apply; if 0.5-0.8, suggest to reviewer
  → LLM semantic match? → YES → present as "AI suggestion" with confidence score
  → FALLBACK → queue in backlog for manual triage
```

For the LLM step, use a small model (e.g., GPT-4o-mini or claude-3-haiku) with a prompt like:

```
Given this Ind AS financial statement label:
"{raw_label}"
Statement: {statement}

Which of these canonical Penman-Nissim categories does it most closely belong to?
{candidate_canonical_keys}

Return the best match and a confidence score (0-1). If none fit, return "unmapped".
```

Expected coverage improvement: from 3.8% to ~40% immediately (pattern-based), to ~70% with ML suggestions reviewed by a domain expert.

---

## 4. Traceability Envelope Upgrade

### 4.1 What V8 Does Well

The current `2026-04-traceability-v8` envelope includes:
- Rigor ladder state (5 gates).
- Parser fidelity (score, status, checks).
- Reconciliation residuals (status, ratio, checks).
- Mapping coverage (by severity, by tier, backlog preview).
- Confidence summary (status, tone, headline).
- Policy version tracking.

### 4.2 What Is Missing

**1. Per-period traceability** — Currently, traceability is run-wide. A company with 15 periods may have periods 1-14 reconciling perfectly and period 15 failing. The envelope should carry:

```typescript
interface PerPeriodTraceability {
  period_end: string;
  parserFidelityScore: number;
  residualRatios: {
    balanceSheetIdentity: number;
    cashDistributionBridge: number;
    debtFlowIdentity: number;
    incomeIdentity: number;
    shareCapitalTieOut: number;
  };
  flags: SpecFlag[];
  contaminationTier: ContaminationTier;
  qualitySummary: {
    piotroski: number;
    beneishMscore: number | null;
    altmanZprime: number | null;
  };
  valuationAnchor: "production-ready" | "guarded" | "blocked" | null;
}
```

**Why important**: Valuation anchors can differ materially period-to-period. A user who changes config (tax rate, OCI treatment) should see which periods cross the reconciliation threshold, not just a binary "pass/fail" for the whole run.

**2. Cross-period consistency checks**:
- Are residual values (RE, ReOI) monotonic within bounds?
- Does growth of operating assets align with growth of retained earnings?
- Are ratio trajectories plausible (e.g., RNOA should not swing from 5% to 80% without a flagged catalyst)?

```typescript
interface CrossPeriodConsistencyReport {
  reGrowthAlignedWithNoaGrowth: boolean;
  ratioAnomalyPeriods: Array<{
    period: string;
    metric: string;
    value: number;
    priorValue: number;
    deviation: number;  // standard deviations from historical mean
  }>;
  structuralBreaks: Array<{
    period: string;
    type: "regime_change" | "accounting_standard_change" | "capital_event";
    evidence: string[];
  }>;
}
```

**3. Data quality scores per metric**:

```typescript
interface DataQualityScore {
  raw_metric_key: string;
  completeness: number;     // % of periods with non-null values
  consistency: number;      // % variance from period-to-period
  plausibility: number;     // within expected range for this metric type
  composite: number;        // weighted average
}
// Aggregate per period and per run
interface RunDataQualityReport {
  avgComposite: number;     // 0-1
  weakestMetrics: DataQualityScore[]; // bottom 10
  statementScores: Record<TraceStatement, number>;
}
```

**4. Proposed V9 Envelope Schema**:

```typescript
interface AnalysisTraceabilityEnvelopeV9 {
  // Existing fields from v8 (unchanged):
  schemaVersion: string;           // "2026-04-traceability-v9"
  generatedAt: string | null;
  runContext: { ... };
  policyVersions: AnalysisPolicyVersions;
  qualityGate: { ... };
  confidence: { ... };
  parserFidelity: ParserFidelitySummary;
  reconciliation: ReconciliationResidualSummary;
  rigor: { ... };
  mappingCoverage: { ... };
  governance: { ... };
  analysisContext: { ... };
  backlogPreview: TraceabilityBacklogPreview[];

  // NEW in v9:
  perPeriod: PerPeriodTraceability[];
  crossPeriodConsistency: CrossPeriodConsistencyReport;
  dataQuality: RunDataQualityReport;
  configFingerprint: string;       // SHA-256 of EngineConfig
  engineGitHash: string;           // git commit of the engine version used
}
```

**5. Config change impact analysis**: When a user changes `tax_rate_mode` or `oci_treated_as_unusual`, compute a diff between the old and new traceability envelope:

```typescript
interface ConfigChangeImpact {
  changedConfigFields: string[];
  deltaRigorLevel: {
    from: AnalysisRigorLevel;
    to: AnalysisRigorLevel;
  };
  periodsAffected: string[];
  metricsAffected: string[];
  valuationDelta: {
    oldIntrinsic: number;
    newIntrinsic: number;
    deltaPct: number;
  };
}
```

---

## 5. Rigor Ladder Refinement

### 5.1 Are the Current 5 Gates Appropriate?

Yes, the 5-gate structure is sound. But the gates need **sub-gates** and **explicit thresholds**:

```
Gate 0: PARSER_FIDELITY (new pre-gate)
  - Source format detected (Capitaline/Screener/XBRL/JSON/Manual)
  - Period count >= minimum (3)
  - Raw metric key count >= threshold (50 for meaningful analysis)
  - No parser crash / infinite loop
  - Score >= 60 (existing)

Gate 1: SYNTACTICALLY_VALID
  - All parser fidelity checks pass
  - No engine error during recast
  - At least one period produces canonical BS + IS + CF

Gate 2: STRUCTURALLY_RECONCILED
  - All balance-sheet identity residuals < 0.02 (2% of TA)
  - Cash-flow bridge converges or is flagged
  - Share-capital tie-out: FaceValue * Shares ~ ShareCapital within 1%
  - Debt-flow bridge: Delta borrowing ~ Proceeds + Repayment within threshold
  - Income-statement bridges: PAT+OCI=TCI, CoreOI+UOI=OI, CoreNFE+UFE=NFE

Gate 3 (new): SEGMENT_CONSISTENT (inserted between structural and economic)
  - Revenue decomposition matches segment reporting (if available)
  - Geographic/segment ROCE is plausible relative to consolidated
  - Inter-company eliminations are within reasonable bounds
  - Minority interest aligns with subsidiary ownership structure

Gate 4 (renamed from 3): ECONOMICALLY_PLAUSIBLE
  - RNOA within [-0.5, 2.0] (Indian industrial range)
  - SPREAD within reasonable bounds relative to industry
  - Terminal growth rate < ke (growth doesn't outpace discount)
  - NOA growth tracks historical revenue growth
  - EBITDA margin non-negative (or flagged with specific reason)

Gate 5: VALUATION_ELIGIBLE
  - No terminal valuation blockers in unusual item policy
  - Contamination tier <= "GUARDED"
  - At least one valuation anchor produces finite value
  - Identity gap < threshold (from config)

Gate 6 (renamed from 5): PRODUCTION_READY
  - All prior gates pass
  - No outstanding "review" items in mapping backlog
  - Analysis status = "production-ready"
```

### 5.2 Gate Definition as Declarative Contracts

Instead of imperative checks in `analysisTraceability.ts`, use a declarative gate registry:

```typescript
// src/engine/rigorGates.ts

interface RigorGateDefinition {
  id: string;
  label: string;
  dependsOn: string[];        // gates that must pass first
  checks: RigorCheck[];
}

interface RigorCheck {
  id: string;
  label: string;
  severity: "critical" | "warning" | "info";
  evaluate: (ctx: GateContext) => GateResult;
  threshold?: number;
}

interface GateResult {
  passed: boolean;
  value: number | null;
  detail: string;
}

const RIGOR_GATES: RigorGateDefinition[] = [
  {
    id: "parser-fidelity",
    label: "Parser Fidelity",
    dependsOn: [],
    checks: [
      {
        id: "min-periods",
        label: "Minimum period count",
        severity: "critical",
        threshold: 3,
        evaluate: (ctx) => ({
          passed: ctx.rawData.length >= 3,
          value: ctx.rawData.length,
          detail: `${ctx.rawData.length} periods loaded`
        }),
      },
      // ...
    ],
  },
  // ...
];
```

This makes it trivial to:
- Add/remove gates without touching the gate evaluation loop.
- Generate documentation from the gate definitions.
- Surface individual check results in the Debug panel.

---

## 6. Performance

### 6.1 Current Performance Profile

For ITC (3,234 labels x 15 periods = 48,510 data points):

1. **Data ingestion**: Parsing the uploaded file (Capitaline Excel) is the heaviest operation (~200-500ms).
2. **Mapping resolution**: Each of the 15 periods traverses ~180 canonical keys, each with 1-20 aliases → ~15 * 180 * 8 = ~21,600 lookups.
3. **Recast computation**: 15 periods of BS/IS/CF decomposition (~50ms).
4. **Ratios/Quality**: From period 2, ~25 ratios + 40+ quality metrics per period (~30ms).
5. **Anomaly detection**: Scans all periods for outliers (~20ms).

Total compute: ~100-200ms for the pipeline after data ingestion.

### 6.2 Client-Side Bottlenecks

**React re-renders**: `rawData` and `recastData` arrays are large. Every config change triggers re-computation of the entire memo chain and potentially re-renders 14 tab components. Current mitigations:
- `useMemo` for recast pipeline (good).
- Lazy-loaded tab components (good).
- `visibleTabs` filtering prevents rendering heavy tabs without data (good).

What is missing:
- No memoization at the component level for large tables.
- RecastStatements renders ALL periods in a table with no virtualization.
- The `CompanyRegistry` state is updated on every recast run (triggers deep comparison).

### 6.3 Recommendation: Web Workers for Computation

Yes, the heavy recasting pipeline should move to a Web Worker.

**Why**:
- The pipeline is pure (deterministic, no DOM access, no side effects).
- It blocks the main thread for ~200ms (enough to cause UI jank on mobile).
- Multi-company comparison would multiply this by N.

**Implementation**:

```typescript
// src/engine/worker.ts
self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { dataArray, config } = e.data;
  const result = processCompanyDataFull(dataArray, config);
  self.postMessage(result);
};

// src/engine/useRecastWorker.ts
export function useRecastPipeline(
  rawData: RawPeriodData[] | null,
  config: EngineConfig,
): PipelineResult | null {
  const workerRef = useRef<Worker | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);

  useEffect(() => {
    if (!rawData) return;
    workerRef.current?.postMessage({ dataArray: rawData, config });
  }, [rawData, config]);

  // ... handle worker messages with postMessage
}
```

### 6.4 Virtualization for Large Tables

Use `@tanstack/react-virtual` for any table with >20 rows:

```typescript
// RecastStatements is the primary candidate — it renders 15 periods x 30+ BS lines = 450+ rows
import { useVirtualizer } from "@tanstack/react-virtual";

const rowVirtualizer = useVirtualizer({
  count: virtualRows.length, // all expanded BS/IS/CF rows
  getScrollElement: () => tableContainerRef.current,
  estimateSize: () => 32,
});
```

### 6.5 Structured Clone Optimization

Instead of passing 48,510 data points via `structuredClone` in React state transitions, use:

1. **SharedArrayBuffer** for the raw data matrix (48,510 numeric values as Float64 = 388 KB).
2. **IndexedDB** as a secondary cache for raw data, avoiding JSON.stringify/parse on reload.
3. **Selective state updates**: When config changes, only recompute ratios and re-derive the affected fields rather than recomputing the full `recastData[]`.

---

## 7. Multi-Tenant Design

### 7.1 Current State

Multi-tenancy is effectively non-existent. The workspace system (`CompanyWorkspace`, `WatchlistDashboard`) relies on `localStorage` and shared blob storage with no user/workspace isolation.

### 7.2 Proposed Multi-Tenant Architecture

**Authentication**: Use Vercel's native authentication (via Vercel Auth) or integrate Clerk/Vercel Marketplace auth.

**Workspace Model**:

```typescript
interface Workspace {
  id: string;
  name: string;
  owner: string;             // user ID / email
  members: WorkspaceMember[]; // role-based access
  companies: CompanyReference[];
  settings: WorkspaceSettings;
}

interface WorkspaceMember {
  userId: string;
  role: "owner" | "admin" | "analyst" | "viewer";
}

interface CompanyReference {
  id: string;
  externalId: string;
  addedBy: string;
  addedAt: string;
  lastAnalysisRun: string | null;
}
```

**RBAC Permissions**:

| Role | Upload | Run Analysis | Pin Run | Share | Admin |
|------|--------|-------------|---------|-------|-------|
| owner | yes | yes | yes | yes | yes |
| admin | yes | yes | yes | yes | no |
| analyst | yes | yes | no | no | no |
| viewer | no | yes (read-only) | no | no | no |

**API Path Structure**:

```
/api/workspaces                    → list workspaces
/api/workspaces/{id}               → get/update workspace
/api/workspaces/{id}/companies     → list workspace companies
/api/workspaces/{id}/companies     → add company
/api/workspaces/{id}/runs          → list analysis runs
/api/workspaces/{id}/runs/{runId}  → get pinned run
/api/workspaces/{id}/comparisons   → manage comparison sets
```

**Data Isolation**: Every database query is scoped by `workspace_id`. The `/api/research` endpoint becomes `/api/v2/workspace/{workspaceId}/...`.

**Shared Research Evolution**: The current "shared" research blob model (where any user can read/write any company's data) is replaced by:
- **Workspace-private data**: Only workspace members can access.
- **Marketplace data**: Curated datasets (e.g., NIFTY 50 company mappings) shared across all workspaces, stored with `workspace_id = NULL`.

---

## 8. API Design

### 8.1 Current API Problems

The current `/api/research/index.js` has several architectural issues:

1. **Single endpoint, dual concern**: One handler does GET and POST for multiple resource types, keyed by `kind` query/body parameter. This is the "resource soup" anti-pattern.
2. **No pagination**: `listJsonBlobs(..., 80)` reads up to 80 blobs. No cursor, no limit parameter.
3. **No schema validation**: The handler trusts `body.kind`, `body.companyId`, etc. without validation.
4. **No authentication**: `maybeRequireResearchReadAuth` is optional (blob reads work without auth).
5. **Error handling**: Returns `null` on fetch failures instead of error responses.
6. **No idempotency**: POST writes are not idempotent — same payload written twice produces different blob timestamps.

### 8.2 Proposed RESTful API Structure

```
# Companies
GET    /api/v2/companies                          → list (paginated, filterable)
POST   /api/v2/companies                          → create
GET    /api/v2/companies/{companyId}              → get company + latest run
DELETE /api/v2/companies/{companyId}              → delete

# Raw Data
GET    /api/v2/companies/{id}/raw-data            → list periods
POST   /api/v2/companies/{id}/raw-data            → upload period data
DELETE /api/v2/companies/{id}/raw-data/{period}   → delete period

# Analysis Runs
GET    /api/v2/companies/{id}/runs                → list runs (paginated)
POST   /api/v2/companies/{id}/runs                → trigger run
GET    /api/v2/companies/{id}/runs/{runId}         → get run results
DELETE /api/v2/companies/{id}/runs/{runId}         → delete run

# Mapping Spec
GET    /api/v2/mapping-spec                       → get active spec
POST   /api/v2/mapping-spec/labels                → suggest/add label
GET    /api/v2/mapping-spec/backlog               → listing backlog (paginated)
PATCH  /api/v2/mapping-spec/backlog/{id}          → triage decision

# Comparison
GET    /api/v2/comparison-sets                    → list comparison sets
POST   /api/v2/comparison-sets                    → create comparison set
GET    /api/v2/comparison-sets/{setId}             → get results
GET    /api/v2/comparison-sets/{setId}/export      → CSV/Excel export

# Webhook (for re-processing)
POST   /api/v2/webhooks/run-complete              → notification on run completion
```

### 8.3 Implementation with Vercel Serverless

```typescript
// Using Hono for clean routing (small bundle, works on Vercel)
// api/v2/index.ts — catch-all route

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { companiesSchema, runSchema } from "./schemas";

const app = new Hono();

app.get("/companies", async (c) => {
  const { page, limit, workspaceId } = parseQuery(c);
  const companies = await db.companies.findMany({
    where: { workspaceId },
    skip: (page - 1) * limit,
    take: limit,
    include: { latestRun: true },
  });
  return c.json({ data: companies, meta: { page, total: count } });
});

app.post("/companies/:id/runs", zValidator("json", runSchema), async (c) => {
  const { id } = c.req.param();
  const run = await triggerAnalysisRun(id, c.req.valid("json"));
  return c.json(run, 201);
});

export default app;
```

### 8.4 Vercel Cron Integration

```json
// "crons" in vercel.json
{
  "crons": [
    {
      "path": "/api/v1/crons/reprocess-stale-companies",
      "schedule": "0 2 * * *"  // daily at 2 AM
    },
    {
      "path": "/api/v1/crons/expire-old-runs",
      "schedule": "0 3 * * 0"  // weekly Sunday at 3 AM
    }
  ]
}
```

---

## 9. Testing Strategy

### 9.1 Current State

- 39 test files with ~120 tests (Vitest).
- Golden test suite for regression safety.
- Tests run against 6 canonical company fixtures.

### 9.2 Challenges at Scale

With 3,234 raw labels per company:
- Testing every label mapping combination is combinatorially impossible.
- Changing the mapping spec can break dozens of assertions.
- Config changes (tax rate, OCI treatment) multiply test permutations.

### 9.3 Recommended Testing Architecture

**Tier 1 (Unit, fast, <1s)**:
- Each mapping spec key has a unit test verifying it resolves correctly.
- Canonical type constructors validate invariants (e.g., `TA = OA + FA`).
- Rigor gate checks tested in isolation.

```typescript
// src/engine/__tests__/mappingSpec.spec.ts
describe("mapping spec", () => {
  for (const [canonicalKey, aliases] of Object.entries(SPEC.balanceSheet)) {
    describe(`BS.${canonicalKey}`, () => {
      for (const alias of aliases) {
        test(`resolves "${alias}"`, () => {
          const period = buildRawPeriod({ metricValues: { [alias]: 100 } });
          const result = resolveMapping(period, SPEC);
          expect(result.get(canonicalKey)).toBe(100);
        });
      }
    });
  }
});
```

**Tier 2 (Integration, <5s)**:
- Full pipeline on each golden fixture with known outputs.
- Config mutation tests (change tax rate → recast changes appropriately).
- Traceability envelope validates against schema.

```typescript
// src/engine/__tests__/traceabilitySchema.spec.ts
test("envelope conforms to v9 schema", () => {
  const envelope = buildAnalysisTraceability({ ... });
  const errors = validateSchemaV9(envelope);
  expect(errors).toHaveLength(0);
});
```

**Tier 3 (Contract, <15s)**:
- API endpoints return expected shapes.
- Database round-trip (persist raw data, retrieve, run pipeline, compare).
- Multi-company comparison produces consistent results.

**Tier 4 (Property-based, slow, <30s)**:
- Property tests for mathematical invariants:
  - "Balance sheet always balances within epsilon of Total Assets * 0.02"
  - "RE(t) = RE(t-1) + PAT(t) - Dividends" identity
  - "ROCE = EBIT / (Total Assets - Current Liabilities)" always equals reconstructed ROCE

```typescript
// Use fast-check for property-based testing
import fc from "fast-check";

describe("recast invariants", () => {
  fc.assert(fc.property(rawPeriodArb, fc.array(fc.integer()), (period, taxRates) => {
    const config = { ...DEFAULT_CONFIG, tax_rate_mode: "effective" };
    const recast = computeRecastPeriod(period, config);
    // TA = OA + FA
    expect(Math.abs(recast.bs.TA - (recast.bs.OA + recast.bs.FA))).toBeLessThan(epsilon);
  }));
});
```

**Golden Test Strategy Enhancements**:
- Instead of storing full serialized `RecastPeriod[]` snapshots, store **checksums** and **diffable summaries**.
- When a golden test fails, output a structured diff showing exactly which canonical values changed and by how much.
- Add a "golden approval" CLI that lets reviewers accept intended changes.

```typescript
// Golden test with summaries instead of full snapshots
test("ITC golden recast", () => {
  const result = processCompanyData(itcData, DEFAULT_CONFIG);
  expect(snapshotOf(result)).toMatchSnapshot("itc-recast-v9");
  // snapshot is:
  // - SHA-256 of the full result array (detects any change)
  // - Summary: { periodCount, keyMetrics: { ROCE: [...], RNOA: [...] } }
});
```

---

## 10. Deployment Architecture

### 10.1 Vercel Limits and Bottlenecks

| Limit | Value | Impact |
|-------|-------|--------|
| Serverless function timeout | 60s (Pro), 15s (Hobby) | Fine for current compute |
| Serverless memory | 3,008 MB | Fine for current compute |
| Function bundle size | 250 MB unzipped | ~1.2MB gzipped SPA is well under |
| Blob storage per file | 5 TB | Not a concern |
| Blob storage total | 500 GB (Pro) | Not a concern |
| API routes count | Unlimited | Using catch-all routing |
| Edge function memory | 128 MB | Not currently used |

### 10.2 Bundle Size Optimization

Current state: ~1.2 MB gzipped JS. Vite config already does:
- Manual chunk splitting by vendor package.
- Golden test suite and analytics in a shared chunk.
- Lazy-loaded tab components.

**Further optimizations**:
1. **Remove dead code from engine**: If `financial_institution_mode: false` (the default), tree-shake out the entire financial institution report and related code paths.
2. **Dynamic import for heavy dependencies**: `react`, `recharts`, or any charting library should be dynamically imported only when the relevant tab is visible.
3. **Use Vercel's `analytics` package** for real-user monitoring of bundle sizes and TTI.
4. **Subresource integrity** for critical chunks to prevent loading corrupted bundles.

```typescript
// vite.config.ts addition
{
  build: {
    target: "es2022",
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("recharts")) return "vendor-recharts";
          if (id.includes("exceljs")) return "vendor-excel"; // only needed for export
          if (id.includes("node_modules")) return packageChunkName(id);
          return appChunkName(id);
        },
      },
    },
    modulePreload: { polyfill: false },
  },
}
```

### 10.3 Cold Start Mitigation

Serverless function cold starts range from 200ms to 5s depending on:
- Bundle size.
- Database connection pool initialization.
- Cache warm-up.

Mitigation:
1. **Use Vercel's `runtimeConfig`** to keep connections pooled across invocations.
2. **Pre-warm critical endpoints** with Vercel Cron hitting a health check endpoint every 5 minutes.
3. **Edge caching** with `Cache-Control: s-maxage=60, stale-while-revalidate=300` on GET endpoints.

### 10.4 Deployment Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy to Vercel

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run validate  # typecheck, test, build
      - run: npm run test:golden  # golden tests specifically

  deploy-preview:
    needs: validate
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: amondnet/vercel-action@v25

  deploy-production:
    needs: validate
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: amondnet/vercel-action@v25
        with:
          vercel-args: "--prod"
```

---

## Appendix A: Proposed File Structure

```
penman-v2-analysis-vercel/
├── api/
│   ├── v2/                          # New RESTful API (Hono-based)
│   │   ├── index.ts                 # Catch-all route handler
│   │   ├── schemas.ts               # Zod validation schemas
│   │   ├── middleware/              # Auth, workspace scoping
│   │   └── routes/
│   │       ├── companies.ts
│   │       ├── runs.ts
│   │       ├── mapping.ts
│   │       └── comparisons.ts
│   └── research/                    # Legacy (deprecated, redirect to v2)
├── db/
│   ├── schema.sql                   # Postgres DDL
│   ├── migrations/                  # Drizzle/Prisma migrations
│   └── seed.ts                      # Seed data for dev/test
├── src/
│   ├── App.tsx
│   ├── components/
│   │   └── ...                      # Existing UI components
│   ├── engine/
│   │   ├── pipeline.ts
│   │   ├── worker.ts                # Web Worker for heavy compute
│   │   ├── useRecastWorker.ts       # React hook for worker communication
│   │   ├── rigorGates.ts            # Declarative gate definitions
│   │   ├── analysisTraceability.ts  # V8 envelope (maintain)
│   │   ├── analysisTraceabilityV9.ts # V9 envelope (new)
│   │   └── ...                      # Existing engine modules
│   ├── lib/
│   │   ├── apiClient.ts             # Generated typed API client
│   │   └── ...                      # Existing lib modules
│   └── types/
│       ├── traceabilityV9.ts
│       └── mappingOntology.ts
├── mapping-spec/
│   ├── canonical.yaml               # Layer 1: canonical spine
│   ├── patterns.yaml                # Layer 3: pattern discovery rules
│   └── mapping-spec.schema.json     # JSON Schema for validation
├── tests/
│   ├── unit/                        # Tier 1
│   ├── integration/                 # Tier 2
│   ├── contract/                    # Tier 3
│   ├── property/                    # Tier 4 (property-based)
│   └── fixtures/
│       └── golden/                  # Golden test fixtures
└── docs/
    ├── architecture-v2.md
    ├── mapping-ontology-guide.md
    └── api-reference.md
```

---

## Appendix B: Priority Matrix

| Initiative | Impact | Effort | Phasing |
|-----------|--------|--------|---------|
| Database migration (Neon/Turso) | High | Medium | Phase 1 (foundational) |
| Declarative rigor gates | Medium | Low | Phase 1 |
| Traceability V9 (per-period, cross-period, quality scores) | High | Medium | Phase 1 |
| Web Worker for pipeline | Medium | Low | Phase 1 |
| Table virtualization | Medium | Low | Phase 1 |
| RESTful API v2 with validation | High | Medium | Phase 2 |
| Mapping Layer 2 (auto-discovery index) | High | Medium | Phase 2 |
| Multi-workspace RBAC | High | High | Phase 2 |
| Mapping Layer 3 (ML-assisted) | Medium | High | Phase 3 |
| Server-side compute pin | Medium | Low | Phase 2 |
| Property-based testing | Medium | Medium | Phase 2 |
| Edge caching for pre-computed analysis | Medium | Low | Phase 3 |

---

## Appendix C: Risks and Trade-offs

| Risk | Mitigation |
|------|-----------|
| Database migration adds complexity and cost | Start with Neon free tier (1 GB); blob writes continue as dual-write during migration |
| Web Workers break determinism assertions | Workers receive pure JSON; output is identical JSON — determinism is preserved |
| ML mapping suggestions may be wrong | ML only suggests; human reviewer must approve; confidence scores visible in backlog UI |
| Multi-tenant changes break existing workflows | Workspace-scoped endpoints are additive; old `/api/research` continues to work during transition |
| Traceability V9 increases envelope size | Per-period traceability is ~2KB x 15 = 30KB; still trivial for modern devices; optional for API responses |
