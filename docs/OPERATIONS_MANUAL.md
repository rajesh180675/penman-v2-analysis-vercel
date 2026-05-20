# Operations Manual — penman-v2-analysis

Complete end-to-end manual: cold-start setup, daily workflow, file naming
conventions, every script, server/frontend architecture, Vercel deploy, and
all the gotchas that have bitten us so far.

This is the **operational** companion to the design docs. For the rigor
ladder, valuation methodology, and audit specs see:
- `LOCAL_USER_MANUAL.md` — user-facing tab-by-tab walkthrough
- `docs/financial-model-rigor-plan.md` — rigor gates
- `docs/COMPREHENSIVE-VALUATION-DESIGN.md` — valuation engine
- `README_DEPLOY_VERCEL.md` — Vercel-specific deployment notes

---

## Table of Contents

1.  [System Requirements](#1-system-requirements)
2.  [One-Time Setup](#2-one-time-setup)
3.  [Daily Workflow — TL;DR](#3-daily-workflow--tldr)
4.  [Project Layout](#4-project-layout)
5.  [The Three Servers](#5-the-three-servers)
6.  [Every Script — What It Does, When to Run It](#6-every-script--what-it-does-when-to-run-it)
7.  [Adding a New Company — End-to-End](#7-adding-a-new-company--end-to-end)
8.  [Capitaline File Naming — Strict Rules](#8-capitaline-file-naming--strict-rules)
9.  [Special Pipelines (Bank / NBFC / Insurance)](#9-special-pipelines-bank--nbfc--insurance)
10. [Vercel Deployment](#10-vercel-deployment)
11. [Vercel Blob Storage](#11-vercel-blob-storage)
12. [Environment Variables](#12-environment-variables)
13. [Pre-Flight Checklist (Before Every Push)](#13-pre-flight-checklist-before-every-push)
14. [Troubleshooting — Known Gotchas](#14-troubleshooting--known-gotchas)
15. [Reference: All Commands](#15-reference-all-commands)

---

## 1. System Requirements

| Component | Required Version | Why |
|---|---|---|
| Node.js  | `^20.19.0` or `>=22.12.0` | ESM + Vite 7 + React 19 |
| npm      | bundled with Node | package manager |
| Python   | 3.10+ (3.11 used in CI) | sidecar parsers + AR extractors |
| Git      | any recent | source control |
| Git Bash / WSL | Windows only | bash-style scripts |

Everything else is fetched by `npm install`.

Optional but recommended:
- `gh` CLI (`gh auth login`) — easier PR workflow
- `vercel` CLI — for `vercel logs`, `vercel env`, `vercel deploy --prod`
- A modern Chrome / Edge — Vite HMR works best there

---

## 2. One-Time Setup

```bash
# 1. Clone
git clone https://github.com/rajesh180675/penman-v2-analysis-vercel.git
cd penman-v2-analysis-vercel

# 2. Install JS deps
npm ci                       # use ci, not install — locks to package-lock

# 3. Install Python deps for AR extractors (optional unless you regenerate
#    quality_indicators.json yourself)
pip install pymupdf openpyxl

# 4. Local data store dir — auto-created on first run, but pre-create to
#    avoid first-run race
mkdir -p ~/.penman-data/{audit,research,blackboard}    # POSIX
# Windows: mkdir %USERPROFILE%\.penman-data\audit etc.

# 5. Verify Node version
node -v                      # must satisfy package.json engines

# 6. Smoke test
npm run typecheck            # tsc --noEmit, must pass clean
npm run test                 # vitest, must show "Tests N passed (N)"
```

If `npm ci` complains about peer-deps, it is almost always a Node version
mismatch. `nvm use 22` (or install 22 via nvm-windows) resolves it.

---

## 3. Daily Workflow — TL;DR

**Local development:**

```bash
npm run dev:local            # starts Vite (5173) + Express API (3001) together
```

Open `http://localhost:5173`. Express on 3001 handles audit, market-data,
research, blackboard. Vite proxies `/api/*` to it.

**Plain Vite-only mode** (no local API — sidecar features fall back to
Vercel if `VITE_USE_REMOTE_API=1`):

```bash
npm run dev                  # vite alone — only static + SPA features work
```

**Run the test suite before every commit:**

```bash
npm run test                 # full suite — must show all green
npm run typecheck            # 0 errors required
```

**Deploy:**

```bash
git push origin main         # Vercel auto-deploys on push to main
```

---

## 4. Project Layout

```
penman-v2-analysis/
├── public/
│   └── data/
│       └── companies/                    # ← all financial data lives here
│           ├── registry.json             # auto-generated index of all companies
│           ├── ITC/
│           │   ├── ITC.zip               # auto-built from .xls files (gitignored .xls)
│           │   ├── standalone.zip
│           │   ├── BalanceSheetINDAS_.xls
│           │   ├── ProfitLossINDAS_.xls
│           │   ├── CashFlow_.xls
│           │   ├── SegmentFinance_.xls
│           │   ├── revised schd/         # optional revised consolidated
│           │   ├── standard/             # optional pre-IndAS view
│           │   └── standalone/           # standalone .xls files
│           ├── Bajaj Finance/
│           │   ├── Bajaj Finance.zip
│           │   ├── standalone.zip
│           │   ├── quality_indicators.json   # NBFC sidecar (Python-merged)
│           │   ├── RBI NHB Banks/        # Capitaline structured export — input to merger
│           │   ├── Loss Given Default/
│           │   └── Subsidiaries/
│           └── ...12 more companies
├── src/                                  # React + TS source
│   ├── App.tsx                           # tab routing, state orchestration
│   ├── engine/                           # ~93 files: parsers, valuation, recast
│   │   ├── pipeline.ts
│   │   ├── bankPipeline.ts
│   │   ├── bankQualityIndicators.ts      # loads quality_indicators.json
│   │   ├── bankValuation.ts
│   │   ├── grahamDoddEPV.ts
│   │   └── ...
│   ├── components/                       # ~39 files: UI surfaces
│   │   ├── DataEntry.tsx                 # company picker + ZIP loader
│   │   ├── FinancialInstitutionReport.tsx
│   │   ├── data-entry/CompanyLibraryGrid.tsx
│   │   └── dashboard/SubsidiaryContributionPanel.tsx
│   └── lib/                              # audit snapshots, registry store
├── server/                               # local Express API (mirrors api/)
│   ├── index.ts                          # express bootstrapping on :3001
│   ├── routes/marketData.ts              # NSE + Yahoo proxies
│   ├── routes/audit.ts
│   ├── routes/research.ts
│   └── store/fsStore.ts                  # ~/.penman-data/* JSON store
├── api/                                  # Vercel serverless functions
│   ├── market-data/snapshot.js           # production NSE proxy
│   ├── audit/*                           # 6 audit endpoints
│   ├── research/index.js
│   ├── blackboard/index.js
│   └── cron/                             # Vercel cron jobs
├── scripts/                              # build-time + maintenance scripts
│   ├── validate-registry.ts              # prebuild — registry consistency check
│   ├── upload-to-blob.mjs                # push ZIPs + sidecars to Vercel Blob
│   ├── extract_nbfc_quality.py           # AR PDF → quality_indicators.json
│   ├── parse_nbfc_capitaline_extras.py   # Capitaline XLS sidecars → JSON
│   └── extract_bank_quality.py           # bank AR PDF extractor
├── sync-companies.cjs                    # iron-clad ZIP packager + registry builder
├── package.json
├── vite.config.ts                        # G5 manual chunks
├── vercel.json                           # framework=vite, build=npm run build
└── tsconfig.json
```

Key invariants:
- **Folder name == registry `folder` field == ZIP base name.** `Bajaj Finance/` produces `Bajaj Finance.zip`. Mismatches break the loader.
- **`.xls` and `.xlsx` files are gitignored** (raw Capitaline data). The committed artefact is the ZIP.
- **`registry.json` is generated, but committed.** Running `sync-companies.cjs` regenerates it idempotently — no commits if nothing changed.

---

## 5. The Three Servers

### 5.1 Vite Dev Server — port 5173
React + TypeScript + HMR. Serves the SPA. Started by `npm run dev` or
`npm run dev:local`.

### 5.2 Local API Server (Express) — port 3001
Mirrors the Vercel `api/` functions for offline use. Routes:
- `GET  /api/market-data/snapshot?symbol=BAJFINANCE&provider=nse|yahoo`
- `GET|POST /api/audit/*` (6 sub-endpoints, see `server/routes/audit.ts`)
- `GET|POST /api/research/*`
- `GET|PUT  /api/blackboard?session=foo`

Persistence: `~/.penman-data/<topic>/<key>.json` via `server/store/fsStore.ts`.

### 5.3 Vercel Production — `*.vercel.app`
The same `api/*.js` files run as serverless functions. Persistence in
production goes to **Vercel Blob** (the `@vercel/blob` SDK), not the
filesystem.

In dev, Vite proxies `/api/*` to the local Express on 3001. In production,
Vercel routes `/api/*` to its own serverless functions. UI code is identical.

---

## 6. Every Script — What It Does, When to Run It

### 6.1 `sync-companies.cjs` (auto-runs on every dev start)

**What it does:**
1. Walks `public/data/companies/*/`
2. For each company folder, builds a deterministic ZIP from the `.xls`
   files inside (root + `revised schd/` + `standard/` + `standalone/`)
3. Builds a separate `standalone.zip` if `standalone/` subfolder exists
4. Looks up the company in `BASELINE_METADATA` (case-sensitive primary +
   case-insensitive fallback with warning)
5. Generates `registry.json` with all companies, preserving Blob URLs
6. **Skip-write if hash unchanged** — both ZIPs and registry only get
   rewritten when content actually differs

**When you must run it manually:**
- After adding a new company folder
- After adding/replacing `.xls` files in an existing folder
- After editing `BASELINE_METADATA` keys (e.g. fixing ticker)

**You almost never need to.** It runs automatically via the `dev` and
`build` scripts.

**Iron-clad guarantees** (post-fix `e72bf4bc`):
- ZIPs are byte-stable across runs (sorted entries, fixed UTC date,
  pre-created folder entries with fixed date, DOS platform header)
- Loud warnings on metadata key casing drift, missing metadata, ticker
  drift
- `BASELINE_METADATA` keys must match disk folder names exactly; case
  mismatch surfaces as a stderr `WARN`

### 6.2 `scripts/validate-registry.ts` (prebuild gate)

**What it does:**
- Loads `registry.json`
- Verifies each entry's `folder` matches an actual on-disk directory
  (case-sensitive — important for Linux)
- Verifies the consolidated ZIP file `<folder>/<folder>.zip` exists
- Exits 1 with a clear error message if any mismatch

**When it runs:**
- Automatically before `dev`, `dev:local`, and `build` (via npm `pre*` hooks)
- You can run it manually: `npx tsx scripts/validate-registry.ts`

### 6.3 `scripts/upload-to-blob.mjs` (manual — when adding a company OR rotating Blob store)

**What it does:**
- Reads `BLOB_READ_WRITE_TOKEN` from environment
- Walks `public/data/companies/*/`
- Uploads the consolidated ZIP, standalone ZIP, `quality_indicators.json`,
  and any sidecar XLS folders (`Subsidiaries/`, `RBI NHB Banks/`,
  `Loss Given Default/`) to Vercel Blob
- Writes the resulting URLs back into `registry.json` as
  `blobUrl`, `standaloneBlobUrl`, `qualityIndicatorsBlobUrl`,
  and `sidecarBlobs.{subsidiaries,rbiNhbBanks,lossGivenDefault}[]`
- Idempotent: re-uploading writes to the same URL (Vercel Blob `addRandomSuffix: false`)

**When you must run it:**
- After adding a new company (otherwise Vercel deploy can't fetch it)
- After updating any `quality_indicators.json` or sidecar XLS
- After rotating to a new Blob store (token + URL change)
- **Not** after just changing source `.xls` files — sync-companies will
  rewrite the ZIP locally; production needs Blob upload to see it

**How to run:**
```bash
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...  node scripts/upload-to-blob.mjs
```

**Token stewardship:** never commit the token. It lives in `.env.local`
(gitignored) for local use and in Vercel project env vars for production.

### 6.4 `scripts/extract_nbfc_quality.py` (manual — when adding NBFC AR PDFs)

**What it does:**
- Walks a company folder for `*_AR_FY*.pdf` files
- Uses pymupdf + regex to extract IndAS 109 stage / CRAR / AUM /
  cost-to-income ratios
- Writes `quality_indicators.json` with one period per AR

**When to run:**
- First-time setup of a new NBFC
- Adding a new fiscal year's AR PDF
- After updating regex patterns in the script

```bash
python scripts/extract_nbfc_quality.py "Bajaj Finance"
```

### 6.5 `scripts/parse_nbfc_capitaline_extras.py` (manual — Bajaj-style structured sidecars)

**What it does:**
- Reads `RBI NHB Banks/*.xls`, `Loss Given Default/*.xls`,
  `Subsidiaries/*.xls` (Capitaline's HTML-table-pretending-to-be-XLS format)
- Merges all three into the existing `quality_indicators.json`,
  preserving AR-extracted AUM and cost-to-income
- Outputs the merged JSON with proper schema header

**When to run:**
- After dropping new Capitaline structured exports into a company folder
- After extending `extract_nbfc_quality.py` (re-run that, then this)

```bash
python scripts/parse_nbfc_capitaline_extras.py "Bajaj Finance"
```

**Output schema** (loader-required keys):
```json
{
  "schema_version": "2026-05-bank-quality-v1",
  "company_name": "Bajaj Finance Ltd",
  "as_of_date": "2025-03-31",
  "source_notes": "...",
  "ticker": "BAJFINANCE",
  "scope": "consolidated",
  "periods": [...]
}
```

### 6.6 `scripts/refresh-company.mjs` (one-shot wrapper — recommended path)

**What it does:**
- Reads `registry.json` to identify the company's `type`
- Dispatches to the right pipeline:
  - `bank` → `extract_bank_quality.py <ticker>` → `sync-companies.cjs`
  - `nbfc` → `extract_nbfc_quality.py <ticker>` → `parse_nbfc_capitaline_extras.py "<folder>"` → `sync-companies.cjs`
  - `insurance` → `extract_insurance_quality.py` → `sync-companies.cjs`
  - everything else → `sync-companies.cjs` only
- Skips gracefully when AR PDFs or sidecar folders are missing
- Tolerates casing typos (warns + uses registry value)
- Prints a clean summary of what ran vs what was skipped

**Usage:**

```bash
npm run refresh -- "Bajaj Finance"          # full NBFC pipeline
npm run refresh -- "HDFC Bank"              # bank pipeline
npm run refresh -- ITC                      # sync only

# Dry run — show what would happen, do nothing:
npm run refresh -- --dry-run "Bajaj Finance"

# Skip the AR extractor (when you only refreshed Capitaline files):
npm run refresh -- --skip-extract "Bajaj Finance"
```

This is the **preferred** way to refresh a company — it removes the
"forgot to run the merger" failure mode that left `quality_indicators.json`
half-stale in past sessions. The individual scripts in 6.4 / 6.5 / 6.7 are
still callable directly when you need fine control.

### 6.7 `scripts/extract_bank_quality.py` and `scripts/extract_insurance_quality.py`

Same pattern as `extract_nbfc_quality.py` but tuned for bank ARs (HDFC,
ICICI, etc.) and insurance ARs (LIC). Run when adding new ARs.

### 6.9 `scripts/audit-tail.mjs`, `scripts/fetch-audited-run-fixture.mjs`

Operational helpers for the audit pipeline. Read the file headers — they
have specific use cases (debugging audit-monitor jobs).

### 6.10 `scripts/rename-company-folders.ps1`

PowerShell script for renaming company folders to canonical Title-Case on
Windows. Run **only** with the dev server stopped (file locks).

---

## 7. Adding a New Company — End-to-End

This is the canonical path. Follow it in order.

### Step 1: Create the folder

```bash
cd public/data/companies
mkdir "Reliance Industries"               # exact Title-Case is the convention
```

Folder name rules:
- Title-Case for multi-word names: `"Tata Steel"`, `"Bajaj Finance"`
- ALL-CAPS for ticker-like names: `"ITC"`, `"SBIN"`, `"KOTAKBANK"`
- The folder name **must match** what you'll add to `BASELINE_METADATA`

### Step 2: Drop in the Capitaline files

From a fresh Capitaline export:

```
Reliance Industries/
├── BalanceSheetINDAS_.xls       # consolidated BS
├── ProfitLossINDAS_.xls         # consolidated P&L
├── CashFlow_.xls                # consolidated CF
├── SegmentFinance_.xls          # optional — for SOTP
├── Investment_.xls              # optional
├── revised schd/                # optional — Schedule III revised
│   ├── BalanceSheetRevised_.xls
│   ├── ProfitLossRevised_.xls
│   ├── CashFlow_.xls
│   ├── SegmentFinance_.xls
│   └── standalone/              # nested standalone for revised
│       ├── BalanceSheetRevised_.xls
│       └── ProfitLossRevised_.xls
├── standard/                    # optional — pre-IndAS view
│   ├── BalanceSheet_.xls
│   ├── ProfitLoss_.xls
│   └── standalone/
│       ├── BalanceSheet_.xls
│       └── ProfitLoss_.xls
└── standalone/                  # standalone consolidated (CIVIL standalone)
    ├── BalanceSheetINDAS_.xls
    ├── ProfitLossINDAS_.xls
    └── CashFlow_.xls
```

The exact filenames matter — see [Section 8](#8-capitaline-file-naming--strict-rules).

### Step 3: Register the company in `BASELINE_METADATA`

Edit `sync-companies.cjs` and add an entry. The **key must match the
folder name exactly (case-sensitive)**:

```javascript
"Reliance Industries": {
  name: "Reliance Industries",
  ticker: "RELIANCE",                       // NSE symbol — verify on nseindia.com
  sector: "Conglomerate",
  type: "conglomerate",                     // industrial | bank | nbfc | insurance | utility | telecom | it-services | conglomerate | cyclical | loss-maker
  description: "O2C + telecom (Jio) + retail + new energy",
  emoji: "🛢️",
  showcaseFor: "Mixed conglomerate routing",
},
```

If you skip this step, the script falls back to `slice(0, 12)` of the
folder name uppercased — usually wrong. The new code emits a loud `WARN`
in this case so you can't miss it.

### Step 4: For banks / NBFCs / insurers — add `quality_indicators.json`

Run the appropriate extractor:

```bash
# NBFC (Bajaj Finance, etc.)
python scripts/extract_nbfc_quality.py "Reliance Industries"

# Bank (HDFC, ICICI, SBI, Kotak)
python scripts/extract_bank_quality.py "HDFC Bank"

# Insurance (LIC)
python scripts/extract_insurance_quality.py "Life Insurance Corporation of India"
```

If you have Capitaline structured sidecars (rare — Bajaj is the only one
so far), drop them into matching subfolders and run the merger:

```bash
python scripts/parse_nbfc_capitaline_extras.py "Bajaj Finance"
```

### Step 5: Generate ZIPs and registry

```bash
node sync-companies.cjs
```

This builds `Reliance Industries.zip` and `standalone.zip`, and adds the
company to `registry.json` with the new metadata.

Verify:
```bash
npx tsx scripts/validate-registry.ts      # exit 0 = OK
```

### Step 6: Upload to Vercel Blob (production-only)

```bash
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...  node scripts/upload-to-blob.mjs
```

This uploads ZIPs + JSON to Blob and writes URLs back into `registry.json`.

### Step 7: Smoke test locally

```bash
npm run dev:local
# → http://localhost:5173, click the new company in the library grid
```

Verify all tabs render: Statements, Ratios, Quality, Valuation,
Reconciliation, Audit, etc.

### Step 8: Commit + push

```bash
git add public/data/companies/registry.json
git add "public/data/companies/Reliance Industries/"
git add sync-companies.cjs                # if you edited BASELINE_METADATA
git commit -m "feat(data): add Reliance Industries company dataset"
git push origin main
```

Vercel auto-deploys on push to `main`. New company shows up in the
library grid live within 1-2 minutes.

---

## 8. Capitaline File Naming — Strict Rules

The pipeline parses files by exact filename. Wrong name = silently skipped.

### Consolidated (root of company folder)

| Filename | Required? | Purpose |
|---|---|---|
| `BalanceSheetINDAS_.xls` | Yes (industrial / NBFC / IT) | IndAS consolidated BS |
| `ProfitLossINDAS_.xls`   | Yes | IndAS consolidated P&L |
| `CashFlow_.xls`          | Yes | Consolidated CF |
| `SegmentFinance_.xls`    | Recommended | Segment table for SOTP |
| `Investment_.xls`        | Optional | Investment book detail |

### Bank-style (HDFC, ICICI, Kotak, SBI)

Capitaline exports for banks use `BalanceSheet_.xls` (no INDAS suffix —
banks were on the bank-specific format). Use that exactly.

### Standalone (in `standalone/` subfolder, **lowercase**)

Same filenames as consolidated, but inside `standalone/`. The folder name
**must be lowercase** — `Standalone/` will not be picked up.

### Revised (in `revised schd/` subfolder)

Capitaline's "Schedule III revised" view. Filenames have `Revised` suffix:
`BalanceSheetRevised_.xls`, `ProfitLossRevised_.xls`. Standalone version
nested in `revised schd/standalone/`.

### Standard / pre-IndAS (in `standard/` subfolder)

For older periods. Files `BalanceSheet_.xls`, `ProfitLoss_.xls` (no INDAS
in the name). Standalone nested in `standard/standalone/`.

### Sidecar XLS (NBFC-only, Bajaj Finance pattern)

```
Bajaj Finance/
├── RBI NHB Banks/                # Capitaline's "Industry-Wise Banks" export
│   └── *.xls
├── Loss Given Default/           # Capitaline credit risk export
│   └── *.xls   (one per fiscal year)
└── Subsidiaries/                 # Capitaline subsidiary breakdown
    └── *.xls   (one per fiscal year)
```

These are inputs to `parse_nbfc_capitaline_extras.py`, which merges them
into `quality_indicators.json`. The TS app never reads the XLS files
directly.

### Sidecar JSON (banks, NBFCs, insurance)

```
quality_indicators.json
```

Schema-versioned. Loader (`src/engine/bankQualityIndicators.ts`) validates
the header and surfaces fields in the Quality / Bank / Valuation tabs.

---

## 9. Special Pipelines (Bank / NBFC / Insurance)

The engine routes to a different pipeline depending on `type` in
`registry.json` (set via `BASELINE_METADATA`).

| Type | Pipeline File | Valuation Surfaces |
|---|---|---|
| `industrial`, `it-services`, `cyclical`, `conglomerate` | `pipeline.ts` | Penman + GD-EPV + SOTP |
| `bank` | `bankPipeline.ts` (subtype=bank) | Justified P/B, Excess RI, DDM |
| `nbfc` | `bankPipeline.ts` (subtype=nbfc) | P/AUM × ROA, ROA×Leverage RI, CRAR governor |
| `insurance` | `bankPipeline.ts` (subtype=insurance) | EV-based when sidecar has `embedded_value`, else justified P/B floor 0.7x |
| `loss-maker` | `pipeline.ts` w/ guards | DCF only when path-to-profit visible |
| `telecom`, `utility` | `pipeline.ts` (utility-aware terminal RE) | Penman + sector-specific |

The detection logic is in `src/engine/scopePolicy.ts` and
`src/engine/detectSubtype.ts`. Explicit `type` from registry beats heuristics.

### What `quality_indicators.json` enables

- **Bank**: GNPA / NNPA / PCR / CRAR / Tier-1 / CASA / slippage in the
  Quality tab; justified P/B uses CRAR + GNPA in the model
- **NBFC**: All bank fields plus Stage 1/2/3 distribution, ECL coverage,
  AUM, AUM growth. ROA × Leverage RI uses normalized cost-to-income;
  CRAR-buffer growth governor caps `g` based on regulatory headroom
- **Insurance**: Solvency ratio, embedded value, NBM, VNB, persistency.
  EV-based valuation only fires when `embedded_value` is non-null

Without the JSON, all these surfaces show "data unavailable" with a clear
reason. The pipeline never crashes on missing sidecars.

---

## 10. Vercel Deployment

### 10.1 Project setup (one-time)

```bash
# Login
vercel login

# Link the local repo to a Vercel project
vercel link

# Pull env vars (creates .env.local)
vercel env pull .env.local
```

Vercel project config is in `vercel.json`:
```json
{
  "framework": "vite",
  "installCommand": "npm ci",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "crons": [
    { "path": "/api/cron/monitor-audit", "schedule": "17 2 * * *" },
    { "path": "/api/cron/prune-audit", "schedule": "47 2 * * *" }
  ]
}
```

### 10.2 Deploy flow

```bash
git push origin main           # auto-deploys via Vercel git integration
```

Or manually:
```bash
vercel deploy --prod
```

### 10.3 Build pipeline (what Vercel runs)

1. `npm ci` — install
2. `tsx scripts/validate-registry.ts` (prebuild — fail-closed if registry stale)
3. `node sync-companies.cjs` — rebuild ZIPs deterministically
4. `vite build` — produces `dist/` with chunked output (G5 manual chunks)

If validate-registry exits 1, the deploy fails. This is intentional —
better to fail Vercel than ship a broken registry.

### 10.4 Bundle splitting (G5)

`vite.config.ts` defines manual chunks to keep the entry bundle small:
- `vendor-react` (61 KB gz)
- `vendor-charts` (95 KB gz) — recharts + d3
- `vendor-file-parsing` (299 KB gz) — xlsx + jszip
- `vendor-jspdf` (111 KB gz)
- `engine-advanced-analytics` (109 KB gz)
- `index` (77 KB gz) — entry point

Total split was 810 KB monolithic → 77 KB entry + lazy-loaded chunks.

---

## 11. Vercel Blob Storage

### What it is
A public-read object store managed by Vercel. We use it to host the
~5 MB of company ZIPs + ~21 sidecar XLS + 6 sidecar JSON that would
otherwise bloat the build artifact past Vercel's serverless 50 MB limit.

### Active store
`penman-v2-analysis-vercel-blob` at
`zvbqldg4jamf3lhr.public.blob.vercel-storage.com`

### URL pattern
`https://zvbqldg4jamf3lhr.public.blob.vercel-storage.com/companies/<Folder>/<file>`

URL-encoded for spaces (`Bajaj%20Finance`).

### How the loader works

1. App fetches `registry.json` (served by Vite/Vercel from `public/`)
2. Each entry has `blobUrl`, `standaloneBlobUrl`, `qualityIndicatorsBlobUrl`
3. `DataEntry.tsx` prefers `blobUrl` over the local `public/data/...` path
4. In production (Vercel), `blobUrl` always wins — local files are not
   served because `*.xls` is gitignored
5. In local dev, the Blob URLs still work — fallback to local file only
   when no `blobUrl` is set

### Rotating the Blob store

If you need a new store (e.g., quota / billing reasons):

1. Create new store in Vercel dashboard → Storage → Blob
2. Mark it **Public** (Bajaj's data is non-sensitive)
3. Copy the new `BLOB_READ_WRITE_TOKEN`
4. Update Vercel project env var (Settings → Environment Variables)
5. Update `.env.local` for your local upload script
6. Run `BLOB_READ_WRITE_TOKEN=<new>  node scripts/upload-to-blob.mjs` —
   uploads everything to the new host, rewrites `registry.json` URLs
7. Commit `registry.json` and push

### Common mistakes

- **Private store** — Vercel SPA can't authenticate to Blob from the
  browser. Must be public.
- **Forgetting to upload** — sync-companies builds the ZIP locally but
  Vercel doesn't see it. Always run `upload-to-blob.mjs` after changing
  any company data.
- **Stale URLs** — if you renamed a folder, old Blob URLs persist.
  Re-upload to refresh `registry.json`.

---

## 12. Environment Variables

### Local (`.env.local` — gitignored)

A complete template lives at `.env.local.example` (committed). Copy it to
get started:

```bash
cp .env.local.example .env.local
# then edit .env.local with real values
```

Most fields are optional with sensible defaults. The only values you
actually need to set:

```
LOCAL_SERVER_PORT=3001                      # Express port (optional, default 3001)
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...    # only when running upload-to-blob.mjs
```

The full list (audit pipeline tokens, cron secrets, market-data API keys,
GitHub monitor) is documented inline in `.env.local.example`.

### Vercel (Project Settings → Environment Variables)

Required:
- `BLOB_READ_WRITE_TOKEN` — server-side, used by `api/research/*` and `api/blackboard/*`

Recommended:
- `ADMIN_AUDIT_TOKEN` — gates audit writes
- `CRON_SECRET` — gates the two cron endpoints (`api/cron/monitor-audit`,
  `api/cron/prune-audit`). Without this set, the cron routes return 503.

Optional:
- `VITE_USE_REMOTE_API=1` — forces the SPA to call Vercel API even in
  Vite dev mode (useful for debugging production endpoints locally)

### Production fail-closed semantics

Per `README_DEPLOY_VERCEL.md`: protected endpoints return controlled
401/503 when their secrets are missing, instead of silently allowing
writes. Specifically: audit writes, blackboard writes, research writes,
NSE proxy in vendor-backed modes, cron endpoints.

---

## 13. Pre-Flight Checklist (Before Every Push)

```bash
# 1. Tests green
npm run test                    # 690+ tests, all must pass

# 2. TypeScript clean
npm run typecheck               # exit 0

# 3. Build clean
npm run build                   # exit 0; produces dist/

# 4. Registry consistent (the prebuild already runs this, but double-check)
npx tsx scripts/validate-registry.ts

# 5. ZIPs idempotent — sync should be no-op on a clean tree
node sync-companies.cjs         # should print "Registry already up to date"
git status --porcelain          # should be clean (no ZIP drift)

# 6. If Blob data changed — re-upload
BLOB_READ_WRITE_TOKEN=...  node scripts/upload-to-blob.mjs

# 7. Push
git push origin main
```

The full validate command: `npm run validate` — runs typecheck + tests +
build in sequence. For releases: `npm run validate:release` — adds golden
suite first.

---

## 14. Troubleshooting — Known Gotchas

### 14.1 `git status` shows 22 ZIPs as modified after every dev start

**Cause:** Pre-`e72bf4bc` `sync-companies.cjs` baked `Date.now()` into ZIP
entries. **Already fixed.** If you see this on an old branch, rebase onto
main or cherry-pick `e72bf4bc`.

### 14.2 Bajaj Finance live price returns 404 / shows "fallback"

**Cause:** Wrong NSE ticker. Bajaj Finance's NSE symbol is `BAJFINANCE`,
not `BAJAJFINANCE`. **Already fixed in `BASELINE_METADATA`.** If it
regresses, check `registry.json` — sync-companies emits a `WARN Ticker
drift` if baseline disagrees with what's there.

### 14.3 Library card click does nothing (silent failure)

**Cause:** `processZip` had a `typeNotSelected` guard that bailed when
React state hadn't propagated by the time the synchronous call ran.
**Already fixed** — library-card path passes `{skipTypeCheck: true}` because
the type is known from registry.

### 14.4 NBFC Valuation tab is empty

**Cause:** Pre-fix branch required `scopeBlocked === true` which only
fires for mixed-financial conglomerates. NBFCs have `scopeBlocked: false`.
**Already fixed** — branch now fires whenever `bankResult` exists.

### 14.5 `quality_indicators.json` is on disk but tabs say "data unavailable"

**Cause:** Schema header wrong. Loader requires `schema_version`,
`company_name`, `as_of_date`. If you wrote a custom JSON or an older
extractor produced `source/scope/company` keys, it gets rejected
silently (only console.warn).

**Fix:** Re-run the appropriate extractor. They all emit the correct schema
post-`bc7a0a83`.

### 14.6 Vercel deploy succeeds but new company doesn't appear

**Cause:** Forgot to run `upload-to-blob.mjs`. The ZIP is in `public/`
locally but `*.xls` is gitignored, so Vercel has nothing to serve. Local
dev still works (file fallback) which masks the bug.

**Fix:** Always run upload-to-blob after changing any company data, then
commit the registry.json that the script rewrites.

### 14.7 NSE 401 / cookie expired

**Cause:** NSE's `_nseapppid` cookie cycles every 4 minutes. The Express
proxy caches it for 4 minutes; after that it refetches.

**Fix:** None needed — automatic. If you see persistent 401s, NSE may
have changed their auth flow. Check `server/routes/marketData.ts`
`getNseCookie()` for currency.

### 14.8 Tests pass locally, fail on Vercel

Almost always one of:
- File system case sensitivity (Windows ignores casing, Linux doesn't)
- Missing env var on Vercel that's set in `.env.local`
- A `vercel-ignored` path being read at runtime

Run `npx tsx scripts/validate-registry.ts` locally — if it passes
locally on Windows but fails the same check on Linux, it's a casing bug
in `registry.json` vs disk.

### 14.9 "WARN Metadata key X does not match disk folder Y"

The new `sync-companies.cjs` warning. Means `BASELINE_METADATA` has the
right ticker but wrong key casing. Update the key to match disk.

### 14.10 "WARN Ticker drift on X: baseline=A, registry=B"

Means a previous run wrote a stale ticker (typically from the
slice-fallback bug). Baseline wins now — the next sync will overwrite
the registry value. If you intend `B` to be the correct ticker, update
`BASELINE_METADATA[X].ticker = 'B'`.

---

## 15. Reference: All Commands

```bash
# ─── Daily ──────────────────────────────────────────────────────────
npm run dev                    # Vite + sync-companies (frontend only)
npm run dev:local              # Vite + Express API (full local mode) ⭐
npm run server                 # Express API alone (no Vite)

# ─── Verification ────────────────────────────────────────────────────
npm run typecheck              # tsc --noEmit
npm run test                   # vitest run (full suite)
npm run test:golden            # golden suite only (faster)
npm run validate               # typecheck + test + build
npm run validate:release       # adds golden suite

# ─── Build ───────────────────────────────────────────────────────────
npm run build                  # validate-registry + sync-companies + vite build
npm run preview                # serve dist/ locally for smoke test

# ─── Data pipeline ───────────────────────────────────────────────────
npm run refresh -- "Bajaj Finance"                 # one-shot dispatcher (preferred)
npm run refresh -- --dry-run "<Folder>"            # see what would run

node sync-companies.cjs                            # rebuild ZIPs + registry
npx tsx scripts/validate-registry.ts               # consistency check
BLOB_READ_WRITE_TOKEN=...  node scripts/upload-to-blob.mjs

python scripts/extract_nbfc_quality.py "Bajaj Finance"
python scripts/parse_nbfc_capitaline_extras.py "Bajaj Finance"
python scripts/extract_bank_quality.py "HDFC Bank"
python scripts/extract_insurance_quality.py "Life Insurance Corporation of India"

# ─── Vercel ──────────────────────────────────────────────────────────
vercel link                    # one-time
vercel env pull .env.local     # sync env vars from project to local
vercel deploy --prod           # manual deploy
vercel logs --since=1h         # check production logs

# ─── Git ─────────────────────────────────────────────────────────────
git status                     # should be clean after sync-companies
git push origin main           # triggers Vercel deploy
```

---

## Appendix A: File Naming — Complete Reference

| What | Where | Casing | Notes |
|---|---|---|---|
| Company folder | `public/data/companies/<Name>/` | Title-Case or ALL-CAPS | Must match `BASELINE_METADATA` key |
| Consolidated BS | `<Name>/BalanceSheetINDAS_.xls` | Exact | Banks use `BalanceSheet_.xls` |
| Consolidated P&L | `<Name>/ProfitLossINDAS_.xls` | Exact | Banks use `ProfitLoss_.xls` |
| Consolidated CF | `<Name>/CashFlow_.xls` | Exact | |
| Segment | `<Name>/SegmentFinance_.xls` | Exact | Optional but needed for SOTP |
| Standalone subdir | `<Name>/standalone/` | **lowercase** | Title-cased breaks loader |
| Standalone files | `<Name>/standalone/BalanceSheetINDAS_.xls` | Same as consolidated | |
| Revised consolidated | `<Name>/revised schd/` | space + lowercase | |
| Revised standalone | `<Name>/revised schd/standalone/` | nested | |
| Pre-IndAS standard | `<Name>/standard/` | lowercase | Old format |
| Pre-IndAS standalone | `<Name>/standard/standalone/` | nested | |
| NBFC sidecar input | `<Name>/RBI NHB Banks/`, `Loss Given Default/`, `Subsidiaries/` | Title-Case | Bajaj-style only |
| Sidecar JSON | `<Name>/quality_indicators.json` | Exact | Generated by Python extractor |
| Generated ZIP | `<Name>/<Name>.zip` | Matches folder | Built by sync-companies |
| Generated standalone ZIP | `<Name>/standalone.zip` | Exact | Built by sync-companies |
| Registry | `public/data/companies/registry.json` | Exact | Generated, committed |
| Custom metadata | `<Name>/metadata.json` | Exact | Optional, per-folder override |

---

## Appendix B: Adding Capitaline Sidecar Exports (Bajaj-style)

Only NBFCs benefit from this — bank/insurance ARs are processed via PDF
extractors, not Capitaline structured exports.

The pattern:

1. Capitaline → "Banks → Industry-Wise Banks" → export. Save as
   `<Company>/RBI NHB Banks/<some>.xls`.

2. Capitaline → "Credit Risk Analysis → Loss Given Default" → export
   per fiscal year. Save as
   `<Company>/Loss Given Default/<FY>_*.xls`.

3. Capitaline → "Subsidiaries" → export per fiscal year. Save as
   `<Company>/Subsidiaries/<FY>_*.xls`.

4. Run AR extractor first (gets AUM, cost-to-income):
   ```bash
   python scripts/extract_nbfc_quality.py "<Company>"
   ```

5. Run merger (overlays Capitaline structured data):
   ```bash
   python scripts/parse_nbfc_capitaline_extras.py "<Company>"
   ```

6. Verify field coverage — script prints a summary like
   `Key field coverage: 133/180 (73.9%)`. Below 60% means the merger
   missed something — check stderr for parse errors.

7. Re-upload to Blob:
   ```bash
   BLOB_READ_WRITE_TOKEN=...  node scripts/upload-to-blob.mjs
   ```

---

## Appendix C: Decision Tree — "Tabs are empty, what now?"

```
Tab is empty
├── Is it the Valuation tab?
│   ├── financial-institution branch missing? → check App.tsx routing
│   └── industrial branch missing? → check `hasRecast`
├── Is quality_indicators.json on disk?
│   ├── No → run extract_nbfc_quality.py / extract_bank_quality.py
│   ├── Yes but schema_version wrong → re-run extractor (post-bc7a0a83)
│   └── Yes and schema OK → check Blob upload (production-only issue)
├── Live price not loading?
│   ├── Check ticker in registry.json against nseindia.com
│   ├── BAJFINANCE not BAJAJFINANCE — verify in BASELINE_METADATA
│   └── Check server logs (Express :3001) for NSE 401 / cookie expiry
└── Library card click does nothing?
    ├── Check browser console for type-not-selected silent return
    ├── Verify processZip has skipTypeCheck option (post-9c614063)
    └── Hard refresh — Vite HMR may have cached old DataEntry.tsx
```

---

*Last updated: 2026-06. Reflects state after commit `e72bf4bc`
(iron-clad sync-companies.cjs).*

