# Penman V2 Analysis — Complete Local User Manual

**A self-contained Indian equity valuation tool that runs entirely on your machine. No cloud, no API keys, no recurring costs.**

---

## Table of Contents

1. [System Requirements](#1-system-requirements)
2. [One-Time Setup](#2-one-time-setup)
3. [Project Folder Structure](#3-project-folder-structure)
4. [Starting the App (Daily Use)](#4-starting-the-app-daily-use)
5. [Input Files — What You Need](#5-input-files--what-you-need)
6. [Where Capitaline Files Come From](#6-where-capitaline-files-come-from)
7. [End-to-End Workflow](#7-end-to-end-workflow)
8. [Tab-by-Tab Walkthrough](#8-tab-by-tab-walkthrough)
9. [Where Your Data Lives](#9-where-your-data-lives)
10. [Stopping the App](#10-stopping-the-app)
11. [Troubleshooting](#11-troubleshooting)
12. [Advanced — Production Local Build](#12-advanced--production-local-build)
13. [Reference — All Commands](#13-reference--all-commands)
14. [Reference — All File Locations](#14-reference--all-file-locations)

---

## 1. System Requirements

| Component | Required | Where to get it |
|---|---|---|
| Operating System | Windows 10/11, macOS, or Linux | — |
| Node.js | v20.19.0+ or v22.12.0+ | https://nodejs.org/ (LTS installer) |
| npm | v10+ (comes with Node.js) | Bundled with Node.js |
| Git | Any recent version | https://git-scm.com/ |
| RAM | 4 GB minimum | — |
| Disk | 1 GB free | — |
| Browser | Chrome, Edge, or Firefox (latest) | — |
| Internet | Only needed for: NSE live prices, initial `npm install` | — |

**Verify your install** — open a terminal and run:

```
node --version
npm --version
git --version
```

If any of these fail, install the missing tool before continuing.

---

## 2. One-Time Setup

You do this **once**, the first time you set up the project.

### Step 2.1 — Get the code

Open a terminal and run:

```
cd C:\Users\rajesh\WindsurfAPI
git clone https://github.com/rajesh180675/penman-v2-analysis-vercel.git penman-v2-analysis
cd penman-v2-analysis
```

If you already have the folder (which you do, at `C:\Users\rajesh\WindsurfAPI\penman-v2-analysis`), skip the clone and just `cd` into it.

### Step 2.2 — Install dependencies

From inside the `penman-v2-analysis` folder:

```
npm install
```

This downloads ~600 MB of dependencies into `node_modules/`. Takes 2–5 minutes depending on internet speed. You only do this once.

When it finishes, you'll see something like `added 1247 packages in 3m`.

### Step 2.3 — Verify the build works

```
npm run build
```

If you see `✓ built in NN.NNs` at the end, you're ready. The build output goes into `dist/` but you don't need that for development.

### Step 2.4 — Verify the test suite passes (optional)

```
npm run test
```

Should show `Test Files 86 passed (86)` and `Tests 663 passed (663)`. Takes about a minute.

**That's the full one-time setup.** From here on, everything is just `npm run dev:local`.

---

## 3. Project Folder Structure

The complete folder lives at:

```
C:\Users\rajesh\WindsurfAPI\penman-v2-analysis\
```

Key folders you'll touch as a user:

```
penman-v2-analysis\
│
├── public\                          ← static assets, served as-is
│   └── data\
│       └── companies\               ← built-in sample companies (11 included)
│           ├── ITC\
│           │   └── standalone\
│           │       ├── BalanceSheetINDAS_.xls
│           │       ├── ProfitLossINDAS_.xls
│           │       └── CashFlow_.xls
│           ├── HDFC bank\
│           ├── reliance Industries\
│           └── ... (8 more)
│
├── server\                          ← local API server (Express)
│   ├── index.ts                     ← entry point (port 3001)
│   ├── routes\
│   │   ├── marketData.ts            ← NSE proxy
│   │   ├── audit.ts                 ← audit trail to filesystem
│   │   └── research.ts              ← workspace persistence
│   └── store\fsStore.ts             ← read/write JSON to ~/.penman-data/
│
├── src\                             ← React app source code
│   ├── App.tsx
│   ├── components\
│   │   ├── DataEntry.tsx            ← upload screen
│   │   ├── ValuationReport.tsx
│   │   ├── dashboard\
│   │   └── charts\
│   └── engine\                      ← all valuation math (browser-only)
│
├── start-local.bat                  ← Windows one-click launcher
├── start-local.sh                   ← Linux/Mac one-click launcher
├── package.json                     ← npm scripts + dependencies
├── vite.config.ts                   ← Vite + proxy config
└── node_modules\                    ← installed dependencies (auto-created)
```

You should never need to edit anything in `node_modules\`. Treat it as black-box.

---

## 4. Starting the App (Daily Use)

You have **three** ways to start, pick whichever is easiest.

### Option A — Double-click (easiest)

1. Open File Explorer
2. Navigate to `C:\Users\rajesh\WindsurfAPI\penman-v2-analysis\`
3. Double-click `start-local.bat`
4. A black command window opens showing logs
5. Wait ~5 seconds until you see:

```
🏠 Penman local server running at http://localhost:3001
📁 Data stored in ~/.penman-data/
📊 Market data: NSE India (no API key needed)

VITE v6.x.x  ready in NNN ms
➜  Local:   http://localhost:5173/
```

6. Open your browser to **http://localhost:5173**

### Option B — Terminal (recommended for daily use)

Open a terminal (PowerShell, cmd, Git Bash, or Terminal on Mac/Linux):

```
cd C:\Users\rajesh\WindsurfAPI\penman-v2-analysis
npm run dev:local
```

Same output as Option A. The terminal stays open — that's where logs appear.

### Option C — Two terminals (if you want logs separated)

Terminal 1 (API server only):
```
cd C:\Users\rajesh\WindsurfAPI\penman-v2-analysis
npm run server
```

Terminal 2 (UI dev server only):
```
cd C:\Users\rajesh\WindsurfAPI\penman-v2-analysis
npm run dev
```

Then open http://localhost:5173 in your browser.

### What the two ports do

| Port | What runs there | Why you need it |
|---|---|---|
| 5173 | Vite dev server (the React app, all UI) | This is what you open in the browser |
| 3001 | Express API server (NSE prices, audit trail, workspace) | The browser app calls it via `/api/*` |

The header shows a **green "Local" badge** when port 3001 is reachable, **amber "Offline" badge** when it's not.

---

## 5. Input Files — What You Need

The app accepts **five different input formats**. The primary one (that everything is built around) is **Capitaline ZIP**.

### 5.1 — Capitaline ZIP (recommended)

This is what you'll use 95% of the time.

A Capitaline ZIP must contain at least these three files (any case, any folder depth inside the ZIP):

| File | Purpose | Filename pattern |
|---|---|---|
| Balance Sheet | Assets, liabilities, equity | `*Balance*.xls` or `BalanceSheetINDAS_*.xls` |
| Profit & Loss | Revenue, expenses, PBT, PAT | `*Profit*.xls` / `*P&L*.xls` / `*ProfitLoss*.xls` |
| Cash Flow | Operating/investing/financing CF | `*CashFlow*.xls` or `*CF*.xls` |

**Optional (but valuable for conglomerates):**

| File | Purpose | Filename pattern |
|---|---|---|
| Segment Finance | Per-segment revenue, EBIT, assets | `*Segment*.xls` or `SegmentFinance_*.xls` |

**Real example** — what the ITC ZIP contains:

```
ITC.zip
├── BalanceSheetINDAS_.xls
├── ProfitLossINDAS_.xls
└── CashFlow_.xls
```

**Reliance example** (with segments):

```
Reliance Industries.zip
├── BalanceSheetINDAS_.xls
├── ProfitLossINDAS_.xls
├── CashFlow_.xls
└── SegmentFinance_.xls
```

The parser auto-detects which file is which by filename. Folder structure inside the ZIP doesn't matter — flat or nested both work.

### 5.2 — Other accepted formats

- **Screener.in CSV/JSON** — paste from Screener Excel export
- **Custom JSON** — schema documented in the Debug tab
- **MCA XBRL** — Indian regulator's XBRL filings
- **Manual entry** — type numbers directly (worst-case fallback)

For 99% of the workflow, stick with **Capitaline ZIP**. The other paths exist but aren't as battle-tested.

### 5.3 — Where to put your input files

**Anywhere.** The app uploads them through the browser file picker — they don't need to be inside the project folder.

But if you want to use the bundled samples to learn the app, they're already at:

```
C:\Users\rajesh\WindsurfAPI\penman-v2-analysis\public\data\companies\<CompanyName>\standalone\
```

You can:
1. Zip the three `.xls` files yourself, or
2. Upload them directly via the multi-file picker (the parser handles both)

---

## 6. Where Capitaline Files Come From

You need a **Capitaline paid subscription** (you have one). Steps to download:

1. Log in to https://www.capitaline.com/
2. Go to **Companies → Search → enter company name** (e.g. "ITC LTD")
3. Click on the company to open its profile
4. Go to **Financials → Standalone** (or Consolidated, your choice)
5. Each statement (Balance Sheet, P&L, Cash Flow, Segment) has an **Export → Excel** button
6. Download all three (or four) statements
7. Either zip them together, or upload them as a multi-file selection

**Standalone vs Consolidated** — pick one and stay consistent. The bundled samples are mostly Standalone.

**File quality matters.** Capitaline sometimes uses two different HTML rendering patterns for the same statement type. The parser handles both, but if you see a "Parser warnings" panel after upload, check the Debug tab to see what was missed.

---

## 7. End-to-End Workflow

### Step 7.1 — Start the app

```
npm run dev:local
```

Open http://localhost:5173

### Step 7.2 — Land on the Data tab

You'll see five input mode tabs:

```
[ Capitaline ZIP ]  [ Screener ]  [ Custom JSON ]  [ XBRL ]  [ Manual ]
```

**Capitaline ZIP** is the default. Stay there.

### Step 7.3 — Fill the four essential fields

These are always visible at the top:

| Field | What to put | Example |
|---|---|---|
| Company ID | Short identifier (no spaces) | `ITC` |
| Company Type | Pick from dropdown | `Industrial` (for ITC) |
| Market Price (₹) | Current share price | `420` |
| Shares Outstanding (Cr) | Total shares in crores | `1240` |

The dropdown for Company Type drives sector-aware logic. Pick:

- **Industrial** — most companies (ITC, TCS, Power Grid, Tata Steel)
- **Bank** — HDFC Bank, ICICI Bank, SBI, Kotak
- **NBFC** — Bajaj Finance, Bajaj Finserv
- **Insurance** — LIC, HDFC Life, SBI Life
- **Loss-maker** — companies with chronic losses (Vodafone Idea, Paytm)
- **Conglomerate** — Reliance, L&T, ITC if mixed segments

Wrong type = wrong pipeline. The dropdown is more reliable than auto-detection.

### Step 7.4 — (Optional) Expand Advanced Config

Click "Advanced Config ▼" if you want to override:

- **Sector Template** (for valuation premium/discount): paint, IT services, banking, etc.
- **Market Data Provider**: `manual` (default) or `nse` (live prices from server)
- **NSE Symbol**: e.g. `ITC` for live price fetch
- **Tax Rate**: default 25.17%
- **Include OCI**: include other comprehensive income (default off)

For first-time use, skip this. Defaults work for most companies.

### Step 7.5 — (Optional) Expand Cost of Capital

Click "Cost of Capital ▼" only if you want non-defaults:

- **ke** — cost of equity (default 13%)
- **kd** — cost of debt (default 8.5%)
- **tax_rate_for_kd** — for after-tax kd (default 25.17%)

Leave blank to use defaults.

### Step 7.6 — Upload the ZIP

Drag the Capitaline ZIP onto the upload zone, or click to browse. Wait 2–5 seconds while the parser extracts the data.

You'll see one of:

- **Green success banner** — all three statements parsed, periods loaded
- **Amber warning banner** — parsed but with warnings (e.g. one period missing)
- **Red error banner** — fatal parse failure (check Debug tab)

If success, the app **automatically navigates to the Dashboard** tab.

### Step 7.7 — Review the Dashboard

Single screen with everything important, top-to-bottom:

- **Company header card** — confidence dots (green/amber/red), type badge, market cap, segment count
- **Investment Thesis card** — single buy/hold/avoid verdict (Screaming Buy / Buy / Hold / Avoid / Distressed)
  - Synthesizes moat + capital allocation + distress + margin of safety into one answer
  - Shows reasoning bullets and price-vs-value comparison
- **Narrative Card** — plain-English 3-paragraph synthesis (Business Quality / Capital Allocation / Valuation & Outlook)
  - Auto-generated from the underlying signals
  - Adjective swaps based on score tiers ("wide and durable" / "narrow but real" / "thin")
- **4 KPI tiles** — ROCE, Revenue Growth, FCF Yield, Intrinsic Value (each with sparkline)
- **Main charts row**:
  - Penman decomposition chart (PM × ATO → RNOA over time, area chart)
  - Valuation triangulation (bar chart: EPV / RE base / RE ceiling vs market price)
- **Value Range Gauge** — horizontal gauge showing where market price sits in the intrinsic band, with MoS badge
- **Moat + Capital Allocation row** (side-by-side):
  - **Moat panel** — composite score (0-100), width badge (Wide/Narrow/None), trend, 5 dimension bars (RNOA Persistence, SPREAD Durability, Margin Stability, Reinvestment Quality, ATO Stability), CAP years
  - **Capital Allocation panel** — letter grade (A/B/C/D), trend, 5 dimension bars (Dividend Consistency, Buyback Quality, Reinvestment ROIC, FCF Conversion, Payout Sustainability), dilutive issuance warning
- **Quality + Ratio Sanity row**:
  - Quality signal panel — traffic lights for reconciliation, parser, sanity, segments, market data
  - Additional KPI tiles — Profit Margin, Asset Turnover, Fin. Leverage, Earnings Quality

If you only want a buy/sell answer, the Investment Thesis card at the top gives it to you in 5 seconds. The Narrative Card explains why in plain English. Everything below is supporting evidence.

### Step 7.8 — Drill into the detail tabs

Use the grouped navigation:

```
Data & Input    Analysis             Valuation       Peers       Export    Advanced
─────────────   ──────────────────   ─────────────   ─────────   ───────   ─────────────────
Data            Statements           Valuation       Comparison  Report    Regression
Dashboard       Ratios                Bank                                  V3 Analytics
Watchlist       Quality                                                     Debug
Workspace       Forecast
Runs
```

Click any tab to dig deeper. Order doesn't matter — they all read from the same loaded data.

### Step 7.9 — (Optional) Add more companies for peer comparison

Repeat Steps 7.2–7.6 with a different ZIP. Each upload adds the company to the **Company Registry** (kept in memory + IndexedDB).

Once you have 2+ companies loaded, the **Comparison** tab activates with:

- ROCE vs P/B scatter plot (quadrant positioning)
- PM vs ATO scatter plot (business model map)
- Percentile ranking bars (ROCE, upside)
- **Peer Relative Valuation panel** — multiple-implied fair values from peer medians

### Step 7.10 — Export

Go to the **Report** tab. Click "Generate Excel Workbook". You get a multi-sheet `.xlsx` with:

- Cover sheet (company facts + confidence stamp)
- Recast statements
- Ratio analysis with banded sanity stamps
- Forecast scenarios (base/bull/bear/Monte Carlo)
- Valuation triangulation (RE / EPV / SOTP)
- Traceability sheet
- Ratio Sanity sheet (per-check detail)

File saves to your browser's default download folder.

---

## 8. Tab-by-Tab Walkthrough

### Data & Input group

#### **Data** tab
Upload Capitaline ZIPs, configure company metadata, set cost of capital. The entry point.

#### **Dashboard** tab (most important)
Single-screen company overview. KPIs, charts, valuation gauge, quality signals. Auto-shown after a successful upload.

#### **Watchlist** tab
List of all companies currently in the registry. Click any to switch the active company.

#### **Workspace** tab
Persistent notes/research per company. Saved to `~/.penman-data/research/workspaces/<company>.json`. Survives across sessions.

#### **Runs** tab (Audit Inspector)
Lists every analysis run. For audit-critical workflows, every upload + every config change is logged. Persists to `~/.penman-data/audit/`.

### Analysis group

#### **Statements** tab
Recast Penman-Nissim statements: NOA / FO / OL split, Operating Income vs Financing Income separation. Now visual-first:
- **Income Statement Waterfall** — Sales → OI → PBT → PAT bars (color-coded: blue totals, emerald subtotals, red deductions) with Op Margin and Net Margin badges
- **Balance Sheet Composition** — stacked bars showing Operating vs Financial Assets evolution + Equity vs NFO vs Operating Liabilities mix; respects the Display Mode toggle (₹ Cr or common-size %)
- **Cash Flow & FCF Trend** — composed chart with CFO and Capex bars + FCF line overlay; aggregate strip shows Total CFO, Capex Intensity, FCF/Dividend coverage
- Three full statement tables (BS / IS / CF) below the charts for the precise numbers

#### **Ratios** tab
- Sparkline KPI grid (ROCE, RNOA, PM, ATO, FLEV, CCR) — 6 tiles with current value, trend arrow, 10Y sparkline
- DuPont 5-factor waterfall chart (Tax Burden × Interest Burden × OPM × ATO × Leverage)
- Three view toggles: Core Ratios / Working Capital Deep Dive / Trend (C-03)
- Tables with NSE-500 benchmarked bands

#### **Quality** tab
Reconciliation checks (TA = E + L, Revenue → PBT → PAT ties), unusual item flags, accruals analysis, ratio sanity bands.

#### **Forecast** tab
- Fade chart (RNOA reverting to terminal)
- Monte Carlo histogram (10,000 paths)
- Scenario cards (base / bull / bear)
- Reverse DCF (what growth is the market pricing in?)

### Valuation group

#### **Valuation** tab (the headline tab)
- **Framework Radar** (5-axis spider): RE, Stress, EPV, Reverse DCF, SOTP
- **Sensitivity Heatmap**: ke × g grid, color-coded vs market
- **EPV Panel** (Graham-Dodd no-growth floor): NOPAT, franchise value, moat badge, MoS
- **Moat panel** (5-dimension Buffett/Munger framework, also visible on Dashboard)
- Scenario cards with intrinsic per share
- Opportunity assessment with confidence rating

#### **Bank** tab
Only relevant when Company Type is Bank / NBFC / Insurance. Now visual-first:
- **Bank Health chart** — 5-tile summary (NIM, ROA, ROE, Credit Cost, Cost-to-Income) + Returns trend line chart with ke reference line + Credit Cost / Cost-Income trend
- Excess Returns model (book value × spread)
- Tier 1 / CAR ratios
- Net Interest Margin decomposition
- For NBFCs: leverage, yield on advances, cost of borrowings, debt mix tables

### Peers group

#### **Comparison** tab
Activates with 2+ companies loaded. Now visual-first:
- **ROCE vs P/B scatter plot** (quadrant positioning — quality vs price)
- **PM vs ATO scatter plot** (business model map — high-margin/low-turn vs low-margin/high-turn)
- **Percentile ranking bars** for ROCE and Upside (visual percentile band per company)
- **Peer Relative Valuation panel** — multiple-implied fair values from peer medians with composite MoS
- Cross-section table at the bottom for the precise numbers

### Watchlist group

#### **Watchlist** tab — visual-first redesign
- **5-tile aggregate KPI strip** at top: Tracked / Buy-Conviction / Watch / Avoid / Avg Score
- Color-coded signal badges with emojis (🚀 Screaming Buy, ✅ Buy, 👀 Watch, 🛑 Avoid)
- Confidence as 3-dot indicator (high/medium/low)
- Score as visual progress bar (color tiered)
- Stress CAGR color-coded by sign
- Active company highlighted with indigo background

### Export group

#### **Report** tab
Generates the Excel workbook (described in Step 7.10).

### Advanced group

#### **Regression** tab
Compares current run vs golden baselines. For developers maintaining the engine.

#### **V3 Analytics** tab
Experimental advanced analytics (rigor scoring, framework reconciliation).

#### **Debug** tab
- Parser diagnostics (every cell mapped + warnings)
- Reconciliation residuals
- Raw data dump
- Use this when something looks wrong upstream.

---

## 9. Where Your Data Lives

When running locally, **nothing leaves your machine**. Two storage locations:

### 9.1 — Server-side (filesystem)

Path: `C:\Users\rajesh\.penman-data\`

```
.penman-data\
├── audit\
│   ├── runs\
│   │   └── <runId>.json           ← run metadata
│   ├── events\
│   │   └── <runId>\
│   │       └── <eventId>.json     ← audit events per run
│   └── uploads\
│       └── <runId>\               ← upload metadata (no actual ZIPs stored)
├── research\
│   └── workspaces\
│       └── <companyId>.json       ← per-company workspace notes
├── blackboard\
│   └── default.json               ← session blackboard
└── market-cache\
    └── <symbol>-<date>.json       ← cached NSE responses
```

You can browse this folder with File Explorer and inspect/back up the JSON files.

### 9.2 — Browser-side (IndexedDB)

The Company Registry (loaded companies in memory) also persists to your browser's IndexedDB. To inspect:

- Chrome/Edge → F12 → Application → IndexedDB → `localhost:5173`
- Firefox → F12 → Storage → IndexedDB

Clearing browser storage **wipes the registry** but does NOT wipe `~/.penman-data/`.

### 9.3 — Backup

To back up everything:

```
xcopy /E /I C:\Users\rajesh\.penman-data D:\Backups\penman-data-2026-05-18
```

That single folder contains all your audit history and workspace notes.

---

## 10. Stopping the App

In the terminal running `npm run dev:local`:

- Press **Ctrl+C** once. Both the Vite dev server and the Express server shut down.
- If only one stops, press Ctrl+C again.

Your data is safe — already written to `~/.penman-data/`.

To restart later, just run `npm run dev:local` again.

---

## 11. Troubleshooting

### "Port 3001 already in use"
Another process is on port 3001. Either:
- Kill it: `netstat -ano | findstr :3001` then `taskkill /F /PID <pid>`, or
- Change the port: set `LOCAL_SERVER_PORT=3002` and update the proxy in `vite.config.ts`

### "Port 5173 already in use"
Vite will automatically try 5174, 5175, etc. Just look at the URL it printed.

### Header shows "Offline" badge
The Express server isn't running. Either:
- You ran `npm run dev` (without `:local`)
- The Express server crashed — check the terminal for errors

Fix: stop everything, run `npm run dev:local`.

### NSE live price doesn't work
- NSE blocks rapid requests. Wait 5 minutes and retry.
- The cookie cache refreshes every 4 minutes server-side.
- If persistent, fall back to manual price entry.

### Parser warnings after upload
Open the **Debug** tab. The "Parser Diagnostics" panel shows:
- Which Capitaline file each metric came from
- Which metrics couldn't be mapped
- Recovery suggestions

Common fixes:
- Re-export from Capitaline (sometimes a stale export has gaps)
- Try Consolidated instead of Standalone (or vice versa)
- For segments, ensure SegmentFinance file is in the ZIP

### "Cannot find module 'jsdom'" or similar test errors
Run `npm install` again. Some module didn't get installed cleanly.

### App is slow / freezes browser
- Monte Carlo defaults to 10,000 paths. Lower it in Forecast tab settings if your machine is older.
- If you have 10+ companies in the registry, peer comparison gets heavy. Remove unused ones from Watchlist.

### Build fails after pulling new code
```
npm install
npm run build
```
Dependencies may have changed since your last pull.

### "Server not detected" but server is running
- Check the badge after a 60s refresh cycle
- Manually open http://localhost:3001/api/health — should return `{"ok":true,"mode":"local",...}`
- If that 404s, the server isn't actually running

### Live NSE prices showing "fallback"
This means NSE's API didn't return a quote. Causes:
- Outside market hours (NSE serves stale data after close)
- NSE rate-limited you (wait 5–10 min)
- Wrong NSE symbol (use the exact ticker, e.g. `ITC` not `ITC.NS`)

---

## 12. Advanced — Production Local Build

For "I want to run this without the dev server" — useful if you're handing the app to a non-technical user or running it in a kiosk:

### 12.1 — Build the static frontend

```
cd C:\Users\rajesh\WindsurfAPI\penman-v2-analysis
npm run build
```

Output goes to `dist/`. This is a static HTML+JS+CSS bundle.

### 12.2 — Run it with the local server

You need both:

Terminal 1 (server):
```
npm run server
```

Terminal 2 (static frontend):
```
npx serve dist -l 5173
```

Then open http://localhost:5173.

### 12.3 — Single-file build (no server needed for non-NSE use)

```
$env:VITE_SINGLE_FILE="1"
npm run build
```

(or on Linux/Mac: `VITE_SINGLE_FILE=1 npm run build`)

This bundles everything into a single `dist/index.html` file. Open it directly in a browser — no server, no dev tools needed. **Caveat**: live NSE prices won't work (no Express server, browser CORS blocks NSE). Manual prices and all valuation logic still work fully.

You can email this single HTML file or put it on a thumb drive.

---

## 13. Reference — All Commands

Run all of these from `C:\Users\rajesh\WindsurfAPI\penman-v2-analysis\`:

| Command | What it does | When to use |
|---|---|---|
| `npm install` | Install all dependencies | One-time, after `git clone` or after `git pull` if dependencies changed |
| `npm run dev:local` | Start Vite + Express together | **Daily — primary command** |
| `npm run dev` | Start Vite only (no local API) | Only if you've deployed to Vercel and want to use cloud APIs |
| `npm run server` | Start Express only on :3001 | Debugging server in isolation |
| `npm run build` | Build production frontend to `dist/` | Before deploying or before single-file build |
| `npm run preview` | Preview the built `dist/` | Sanity-check the production build |
| `npm run test` | Run all 663 tests | After changes, before committing |
| `npm run test:golden` | Run golden + release-gate tests only | Quick smoke test |
| `npm run typecheck` | TypeScript type check (no build) | Quick correctness check |
| `npm run validate` | typecheck + test + build | Full pre-commit gate |
| `npm run validate:release` | typecheck + golden + test + build | Pre-deployment gate |

### One-click launchers

| File | Platform | What it does |
|---|---|---|
| `start-local.bat` | Windows (double-click) | Runs `npm run dev:local` in a terminal window |
| `start-local.sh` | Linux/macOS | Same, runs from terminal |

---

## 14. Reference — All File Locations

| Path | What's there |
|---|---|
| `C:\Users\rajesh\WindsurfAPI\penman-v2-analysis\` | Project root — run all commands from here |
| `...\public\data\companies\` | Bundled sample Capitaline files (11 companies) |
| `...\src\` | React app source code |
| `...\server\` | Express API server source code |
| `...\dist\` | Production build output (only after `npm run build`) |
| `...\node_modules\` | Installed dependencies (auto-managed, never edit) |
| `...\.hermes\plans\` | Architecture/design docs |
| `C:\Users\rajesh\.penman-data\` | Your runtime data (audit, research, blackboard, market cache) |
| `C:\Users\rajesh\.penman-data\audit\` | Every analysis run + every audit event |
| `C:\Users\rajesh\.penman-data\research\` | Per-company workspace notes |
| `http://localhost:5173` | The app (open in browser) |
| `http://localhost:3001/api/health` | Server health check (for troubleshooting) |
| `http://localhost:3001/api/market-data/snapshot?provider=nse&symbol=ITC` | Direct NSE proxy test |

---

## Quick-Start Cheat Sheet

```
1. cd C:\Users\rajesh\WindsurfAPI\penman-v2-analysis
2. npm run dev:local
3. Open http://localhost:5173
4. On Data tab: enter Company ID, pick Type, drop ZIP
5. Land on Dashboard
6. Click through tabs for detail
7. Report tab → export Excel
8. Ctrl+C in terminal to stop
```

That's the whole workflow.

---

**Done.** This document covers the full local workflow end-to-end. Save it in the project root or print it out. Anything not covered is in the Debug tab or in `.hermes/plans/local-first-architecture-plan.md`.
