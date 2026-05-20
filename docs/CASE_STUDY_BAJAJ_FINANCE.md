# Case Study: Loading Bajaj Finance — A Beginner's Walkthrough

**Who this is for:** You know finance and Capitaline, but you don't know
what npm, git, or Vercel are. You want to load Bajaj Finance into the app
and see its valuation. This guide assumes you know nothing technical and
walks you through every click and command.

**Time required:** 30-45 minutes the first time. About 5 minutes after that.

**What you'll have at the end:** Bajaj Finance loaded into the app with all
its tabs working — Statements, Ratios, Asset Quality, Valuation — plus
live NSE price ticking on the dashboard.

---

## Part 1: Understanding What This App Does (5 minutes of reading)

The Penman V2 Analysis app is a **financial calculator on your computer**.
You feed it Capitaline export files for an Indian listed company and it
produces a defensible valuation using the Penman-Nissim framework, plus
sector-specific lenses (banks get justified P/B, NBFCs get P/AUM × ROA,
etc.).

Two ways to use it:

1. **On your computer (offline):** Run two background programs (called the
   "Vite dev server" and the "Express API server"), open a browser, do
   your work. Files stay on your laptop. Free.
2. **On the internet (Vercel):** The same app runs on a public URL like
   `penman-v2-analysis.vercel.app`. Anyone with the URL can use it. Useful
   for sharing analysis with colleagues.

This walkthrough covers the **on-your-computer** path. The Vercel deploy
mirrors it.

---

## Part 2: What You Need Before Starting

You need three pieces of software installed on your laptop:

### Required

| Software | What it does | How to get it |
|---|---|---|
| **Node.js** (version 22) | Runs the app's backend | https://nodejs.org → download the "LTS" version, run the installer |
| **Python** (version 3.11) | Runs the data extractors | https://python.org/downloads → run the installer, **tick "Add to PATH"** |
| **Git** | Downloads the project | https://git-scm.com/downloads → run the installer with default options |

### Already on your machine
- A web browser (Chrome / Edge / Firefox)
- A text editor — Notepad works, but VS Code (https://code.visualstudio.com)
  is friendlier

### How to verify the installs worked

Open a Command Prompt (press Windows key, type `cmd`, hit Enter) and run:

```bash
node --version
```

You should see something like `v22.10.0`. If you see `'node' is not
recognized`, the installer didn't complete. Reinstall Node.js and tick
all the default options.

Repeat for `python --version` and `git --version`. All three need to work.

---

## Part 3: Get the Project onto Your Computer (one-time, 5 minutes)

You need to copy the project from GitHub to your laptop. Do this **once**.

### Step 1: Pick a home for the project

In Command Prompt:

```bash
cd C:\Users\rajesh\WindsurfAPI
```

(Replace `rajesh` with your Windows username if different.)

### Step 2: Download the project

```bash
git clone https://github.com/rajesh180675/penman-v2-analysis-vercel.git penman-v2-analysis
```

This creates a folder `penman-v2-analysis` with the entire project.

### Step 3: Move into the project folder

```bash
cd penman-v2-analysis
```

### Step 4: Install the project's dependencies

```bash
npm ci
```

This takes 2-5 minutes the first time. It downloads about 500 small
software packages the app depends on. You'll see lots of output. As long
as the last line doesn't say "ERROR" you're fine.

### Step 5: Install Python dependencies (only needed for new AR PDFs)

```bash
pip install pymupdf openpyxl
```

You only need this if you're going to extract data from Annual Report
PDFs. Bajaj Finance already has its `quality_indicators.json` ready, so
you can skip this step today.

---

## Part 4: The Bajaj Finance Files — What's Already There vs What You Need

Before you do anything, look at what the project already has for Bajaj
Finance. Open File Explorer and navigate to:

```text
C:\Users\rajesh\WindsurfAPI\penman-v2-analysis\public\data\companies\Bajaj Finance
```

You'll see a folder structure like this:

```text
Bajaj Finance/
├── Bajaj Finance.zip               ← packaged consolidated data (auto-built)
├── standalone.zip                  ← packaged standalone data (auto-built)
├── quality_indicators.json         ← NBFC asset-quality sidecar (already merged)
├── BalanceSheetINDAS_.xls          ← consolidated balance sheet (raw)
├── ProfitLossINDAS_.xls            ← consolidated P&L (raw)
├── CashFlow_.xls                   ← consolidated cash flow (raw)
├── SegmentFinance_.xls             ← consolidated segments (raw)
├── Investment_.xls                 ← investment book (raw)
├── standalone/                     ← standalone Capitaline files
│   ├── BalanceSheetINDAS_.xls
│   ├── ProfitLossINDAS_.xls
│   └── CashFlow_.xls
├── revised schd/                   ← Schedule III revised view
├── standard/                       ← pre-IndAS view
├── RBI NHB Banks/                  ← Capitaline structured export (NBFC sidecar)
│   └── (1 .xls file)
├── Loss Given Default/             ← Capitaline credit risk export
│   └── (7 .xls files, one per year)
└── Subsidiaries/                   ← Capitaline subsidiary breakdown
    └── (13 .xls files, one per year)
```

**Good news:** every file you need for Bajaj Finance is already in the
project. You don't need to re-download anything from Capitaline today.
The walkthrough below assumes you're loading the existing data and
viewing the result.

If you ever want to **refresh** the data (Capitaline added a new fiscal
year, for example), you'd:
1. Drop the new `.xls` files into the matching folders
2. Re-run the Python merger (covered in Part 7 below)
3. Restart the dev server

---

## Part 5: Start the App (every working session, 30 seconds)

Two programs need to run at the same time. The project has a one-line
command that starts both.

### Step 1: Open Command Prompt and navigate to the project

```bash
cd C:\Users\rajesh\WindsurfAPI\penman-v2-analysis
```

### Step 2: Start the app

```bash
npm run dev:local
```

You'll see a flurry of messages. Wait until you see something like:

```json
[vite]  ➜  Local:   http://localhost:5173/
[api]   Local API server listening on http://localhost:3001
```

That means both programs are alive and talking to each other.

**Leave this Command Prompt window open.** Closing it stops the app. If
you accidentally close it, just run `npm run dev:local` again from the
same folder.

### Step 3: Open the app in your browser

Go to: **http://localhost:5173**

You'll see the Penman V2 Analysis homepage with a grid of company cards.

---

## Part 6: Load Bajaj Finance and Click Through Every Tab

### Step 1: Click the Bajaj Finance card

Find the card labeled **Bajaj Finance** in the company library grid. It
should show:
- The 💳 emoji
- "Bajaj Finance"
- "NBFC" or "Consumer finance NBFC"
- A "✓ Cons / ✓ Stan" badge (meaning both consolidated and standalone
  data are available)

Click it. The app loads the ZIP, parses the spreadsheets, runs the
recast / Penman pipeline, and routes you into the analysis screens.

If nothing happens when you click — **hard-refresh the browser**
(Ctrl + Shift + R on Windows). Once.

### Step 2: Look at the top of the page — confirm the live price loaded

You should see Bajaj Finance's live NSE price (around ₹925). If you see
"fallback" or no price, the NSE proxy couldn't reach the live API.
Common reasons:
- You're not connected to the internet
- NSE temporarily blocked the request — wait 5 minutes and refresh

The price comes from `BAJFINANCE` (the correct NSE ticker). If you ever
see a 404 here, check that the ticker in `registry.json` is `BAJFINANCE`
not `BAJAJFINANCE`.

### Step 3: Walk through the tabs

The app shows tabs across the top. For Bajaj Finance, this is the order
to look at them:

#### Tab 1: Dashboard
Quick overview — current price, basic ratios, recent year highlights. If
this is empty, the load failed; nothing else will work either.

#### Tab 2: Statements
The reformulated balance sheet, P&L, cash flow. Penman's reformulation
splits operating from financing. Numbers should look reasonable
(2025 P&L profit ≈ ₹16,000 Cr).

#### Tab 3: Ratios
ROIC, ROE, asset turnover, leverage, growth ratios — calculated from the
reformulated statements. This is where you can sanity-check the data.

#### Tab 4: Quality (or "Asset Quality")
**This is where the NBFC sidecar data shows up.** You should see:
- GNPA / NNPA percentages by year
- CRAR (Capital Adequacy Ratio) — Bajaj keeps this around 22-26%
- Tier-1 capital ratio
- PCR (Provision Coverage Ratio)
- Stage 1 / Stage 2 / Stage 3 distribution (IndAS 109 buckets)
- ECL coverage
- AUM and AUM growth (extracted from Annual Reports)
- Cost-to-income ratio

If this tab says "data unavailable" or shows blank fields, the sidecar
JSON didn't load. See Part 9 (Troubleshooting) below.

#### Tab 5: Valuation
**The key tab for NBFCs.** You should see four valuation lenses:

1. **Justified P/B** — Based on ROE, growth, cost of equity. Floor 0.7×.
2. **P/AUM × ROA** — Multiplier driven by sustainable ROA × normalized P/E.
3. **ROA × Leverage RI** — Three-stage residual income with ROA and
   leverage fading independently.
4. **CRAR-buffer growth governor** — Caps `g` based on regulatory headroom.
5. **Through-cycle credit-cost diagnostic** — Advisory banner.

Each gives a fair value range. The app shows convergence (or divergence)
across the four — if they all cluster around ₹950, that's a strong
signal.

#### Tab 6: Subsidiary Contribution (NBFC-specific)
Lists Bajaj Finance's subsidiaries from the Capitaline `Subsidiaries/`
export — Bajaj Financial Securities, Bajaj Housing Finance, etc., with
PAT, equity, total assets per subsidiary across 13 years. Useful for
SOTP analysis.

#### Tab 7: Quality Audit / Reconciliation
Shows the rigor ladder: did the data pass `syntactically-valid`,
`structurally-reconciled`, `economically-plausible`, `valuation-eligible`,
`production-ready` gates. If a gate failed, the reason is here.

#### Tab 8: Report
A printable summary you can export to PDF.

---

## Part 7: When You Need to Refresh Bajaj Finance Data

Capitaline updates fiscal year data after each annual results season. To
load the new year:

### What you'll do

1. Export the latest Capitaline files for Bajaj Finance
2. Replace the matching files in the project folder
3. Run the data extractors
4. Restart the dev server

### Step 1: Export from Capitaline

Open Capitaline. Find Bajaj Finance. Export:

| Capitaline section | Save as |
|---|---|
| Balance Sheet (IndAS, Consolidated) | `BalanceSheetINDAS_.xls` |
| Profit & Loss (IndAS, Consolidated) | `ProfitLossINDAS_.xls` |
| Cash Flow (Consolidated) | `CashFlow_.xls` |
| Segment Finance (Consolidated) | `SegmentFinance_.xls` |
| Investments (Consolidated) | `Investment_.xls` |

Repeat for the standalone view, saving with the same names but in the
`standalone/` subfolder.

For the NBFC sidecars (Bajaj-specific):

| Capitaline section | Save as |
|---|---|
| Banks → Industry-Wise Banks | `RBI NHB Banks/<some>.xls` |
| Credit Risk → Loss Given Default | `Loss Given Default/<FY>.xls` |
| Subsidiaries | `Subsidiaries/<FY>.xls` |

### Step 2: Drop them into the project folder

Open File Explorer to:
```text
C:\Users\rajesh\WindsurfAPI\penman-v2-analysis\public\data\companies\Bajaj Finance
```

Replace each file with the new export. Match the filenames exactly —
the app parses by filename, not by file content.

### Step 3: Run the one-shot refresh command

This single command does everything — runs the AR extractor (if PDFs are
available), runs the Capitaline merger, repackages the ZIPs, and updates
the registry:

```bash
npm run refresh -- "Bajaj Finance"
```

You'll see output like:

```text
Refreshing: Bajaj Finance  (folder="Bajaj Finance", type="nbfc", ticker="BAJFINANCE")

=== nbfc AR extractor ===
$ python scripts/extract_nbfc_quality.py BAJFINANCE
[ ... extractor output ... ]

=== Capitaline NBFC merger ===
$ python scripts/parse_nbfc_capitaline_extras.py Bajaj Finance
RBI NHB Banks: 15 periods parsed
Loss Given Default: 7 periods parsed
Subsidiaries: 13 periods parsed

=== ZIP packager + registry sync ===
$ node sync-companies.cjs
[ ... ]

============================================================
Refresh complete: Bajaj Finance
============================================================
```

If you don't have the Annual Report PDFs (they live in a separate
`ITC-valuation-template` folder), the extractor step will skip with a
warning — that's fine, the rest still runs.

**Want to see what would happen first?** Add `--dry-run`:

```bash
npm run refresh -- --dry-run "Bajaj Finance"
```

It prints the exact commands without executing anything.

### Step 4: Restart the dev server

In the Command Prompt window where the app is running, press **Ctrl + C**
to stop it, then run `npm run dev:local` again. The new ZIPs are built
automatically and the registry refreshes.

### Step 5: Refresh the browser

Hard-refresh (**Ctrl + Shift + R**) and click the Bajaj Finance card again.
The new fiscal year should appear in every tab.

---

## Part 8: Pushing Changes to the Internet (Vercel) — Optional

Skip this section if you only use the app on your laptop.

Vercel is a service that runs the app on a public URL. The repository is
already connected: every time someone pushes code to GitHub, Vercel
auto-deploys.

### To make new Bajaj data visible on Vercel

1. **Save your work to git:**
   ```
   git add public/data/companies/Bajaj Finance
   git commit -m "data: refresh Bajaj Finance FY2026"
   git push origin main
   ```

2. **Upload the data to Vercel Blob storage** (the production version
   reads from Blob, not from your laptop):
   ```
   set BLOB_READ_WRITE_TOKEN=vercel_blob_rw_zVbQlDg4jAMF3lhR_...
   node scripts/upload-to-blob.mjs
   ```
   The token is in the project's Vercel settings. Don't email it or
   commit it.

3. **Wait 1-2 minutes** for Vercel to redeploy.

4. **Open the live URL** in a browser and verify the new data appears.

---

## Part 9: Troubleshooting — When Bajaj Finance Doesn't Look Right

### "I clicked the card and nothing happened"

Hard-refresh the browser (Ctrl + Shift + R). The dev server may have an
older version of the page cached.

If still nothing: check the Command Prompt where `npm run dev:local` is
running. If you see red text or "Error", screenshot it. Most likely the
server crashed and you need to run `npm run dev:local` again.

### "The Quality tab is empty"

The `quality_indicators.json` file didn't load. Check:

1. Does the file exist?
   ```
   dir "public\data\companies\Bajaj Finance\quality_indicators.json"
   ```
   It should show 1 file.

2. Open it in Notepad. The very first line should look like:
   ```json
   {
     "schema_version": "2026-05-bank-quality-v1",
   ```

   If it says `"source": "capitaline_structured"` instead, the schema
   header is wrong. Re-run:
   ```
   python scripts/parse_nbfc_capitaline_extras.py "Bajaj Finance"
   ```

### "The Valuation tab shows no fair value"

Most likely the company `type` got misclassified. Open
`public/data/companies/registry.json` in Notepad. Find the Bajaj Finance
entry. It should say:

```json
{
  "folder": "Bajaj Finance",
  "name": "Bajaj Finance",
  "ticker": "BAJFINANCE",
  "type": "nbfc",
  ...
}
```

If `type` says `industrial` or anything else, the wrong pipeline ran.
Check that `BASELINE_METADATA` in `sync-companies.cjs` has the right
key (`"Bajaj Finance"` exactly). Then run `node sync-companies.cjs`.

### "Live price says 'fallback' or shows ₹0"

The NSE proxy couldn't reach NSE. Try:

1. Open https://www.nseindia.com in your browser. If that doesn't load,
   you have an internet problem.
2. Check the ticker. NSE listing for Bajaj Finance is **`BAJFINANCE`**.
   If `registry.json` has `BAJAJFINANCE` (note the extra "AJ"), it'll
   404. Fix it by editing the ticker in `BASELINE_METADATA` and running
   `node sync-companies.cjs`.

### "Tests fail before the build" (only relevant if you push to main)

Run them yourself first:
```bash
npm run test
```
You'll see green and red lines. Red ones tell you what broke. If you
didn't change any source code, this shouldn't happen — it usually means
a `quality_indicators.json` is malformed.

### "Git status shows 22 ZIP files modified" (post-2026-06)

This was a real bug. It's been fixed. If you see it on a fresh clone,
you have an old branch. Run:
```bash
git pull origin main
node sync-companies.cjs
git status
```
Should be clean. If it isn't, contact the maintainer.

### "Python scripts fail with 'no module named pymupdf'"

You skipped the Python install step. Run:
```bash
pip install pymupdf openpyxl
```

---

## Part 10: A Day in the Life — Typical Workflow

This is what your routine looks like once you've done the setup once.

### Morning

1. Open Command Prompt
2. `cd C:\Users\rajesh\WindsurfAPI\penman-v2-analysis`
3. `npm run dev:local`
4. Open http://localhost:5173 in browser

### During the day

- Click any company card to load it
- Switch between tabs to inspect different views
- Export reports as PDF from the Report tab
- Toggle between consolidated and standalone (if both are available)

### When new Capitaline data arrives

1. Drop new `.xls` files into the relevant company folder
2. (NBFC only) Run `python scripts/parse_nbfc_capitaline_extras.py "<Company>"`
3. Stop the dev server (Ctrl+C in the Command Prompt)
4. Restart: `npm run dev:local`
5. Refresh browser

### End of day

Press **Ctrl + C** in the Command Prompt to stop the servers. Or just
close the laptop — they'll restart fresh tomorrow.

---

## Part 11: Glossary — Plain English Definitions

| Term | What it means |
|---|---|
| **Repository / repo** | The project's folder, tracked by git |
| **git** | The tool that downloads / uploads code |
| **GitHub** | The website that stores the project online |
| **npm** | The tool that downloads JavaScript dependencies |
| **Node.js** | The program that runs the app's backend |
| **Vite** | The dev server that serves the React frontend on port 5173 |
| **Express** | The dev server that serves the API on port 3001 |
| **HMR (Hot Module Reload)** | When you edit a file, the page updates without you refreshing |
| **Vercel** | The service that hosts the public version of the app |
| **Vercel Blob** | Cloud file storage where Vercel keeps the company ZIPs |
| **`.zip`** | A packaged folder of files. The app loads ZIPs at runtime, not raw `.xls` |
| **`.xls`** | The Capitaline export format (Excel spreadsheet) |
| **`registry.json`** | The list of all companies the app knows about |
| **`quality_indicators.json`** | NBFC / bank / insurance asset-quality data per period |
| **Sidecar file** | A non-Capitaline support file (JSON or extra XLS) the app reads |
| **NSE / BSE ticker** | The 4-12 letter code for a stock on the exchange (e.g. `BAJFINANCE`) |
| **Recast** | Penman-Nissim reformulation: splitting operating from financing items |
| **Rigor ladder** | The 5 quality gates a valuation must pass to be defensible |
| **CRAR** | Capital to Risk-Weighted Assets Ratio — banking capital adequacy |
| **AUM** | Assets Under Management — the size of an NBFC's loan book |
| **ECL** | Expected Credit Loss — IndAS 109 provisioning |
| **PCR** | Provision Coverage Ratio |
| **Stage 1/2/3** | IndAS 109 credit risk buckets (performing / underperforming / impaired) |

---

## Part 12: When to Ask for Help

If after reading this you're stuck on something specific, the
maintainer can help. To save them time, when you reach out include:

1. **What you were trying to do** ("load Bajaj Finance latest data")
2. **What went wrong** ("Quality tab is blank")
3. **What you tried** ("re-ran the Python merger, restarted dev server")
4. **The error message** — copy-paste from the Command Prompt or the
   browser's Developer Tools console (F12 → Console tab)

That gives them everything they need to diagnose without back-and-forth.

---

## Reference: Quick Card

```text
START THE APP:
  cd C:\Users\rajesh\WindsurfAPI\penman-v2-analysis
  npm run dev:local

OPEN IN BROWSER:
  http://localhost:5173

REFRESH BAJAJ DATA:
  1. Drop new .xls files into public/data/companies/Bajaj Finance/
  2. npm run refresh -- "Bajaj Finance"
  3. Restart npm run dev:local
  4. Hard-refresh browser

UPLOAD TO VERCEL:
  set BLOB_READ_WRITE_TOKEN=...
  node scripts/upload-to-blob.mjs
  git add . && git commit -m "data: refresh" && git push

STOP THE APP:
  Ctrl + C in the Command Prompt
```

---

*Last updated: 2026-06. Reflects state after commit `e72bf4bc`. For the
technical reference, see `docs/OPERATIONS_MANUAL.md`. For the rigor
methodology, see `docs/financial-model-rigor-plan.md`.*
