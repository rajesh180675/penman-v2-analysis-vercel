# Local-First Architecture Plan

## Current State Assessment

The app is already 95% local. Here's what runs where:

### Runs entirely in the browser (no server needed):
- Capitaline ZIP parsing → recast periods
- All ratio computation (Penman-Nissim decomposition)
- All valuation models (RE, ReOI, FCFF, FCFE, DDM, AEG, EPV, SOTP)
- Forecast engine (fade, Monte Carlo)
- Ratio sanity, quality gates, reconciliation
- Segment parsing + conglomerate routing
- All UI rendering, charts, dashboard
- Excel export
- Company registry (multi-company in-memory)

### Requires Vercel serverless (api/ folder):
| Endpoint | Purpose | Vercel Dependency |
|----------|---------|-------------------|
| `api/market-data/snapshot.js` | Proxy NSE/Upstox/AlphaVantage (CORS bypass) | None — just needs a server |
| `api/audit/events.js` | Store audit events | `@vercel/blob` |
| `api/audit/runs.js` | List/read audit runs | `@vercel/blob` |
| `api/audit/uploads.js` | Store ZIP uploads for audit trail | `@vercel/blob` |
| `api/audit/backlog.js` | Read audit backlog | `@vercel/blob` |
| `api/research/index.js` | Workspace persistence | `@vercel/blob` |
| `api/blackboard/index.js` | Session blackboard | `@vercel/blob` OR local fs |
| `api/cron/prune-audit.js` | Cleanup old audit data | `@vercel/blob` |

### Key insight:
- `api/blackboard/_localStore.js` already has a filesystem fallback — proof the pattern works
- The engine never calls any API. Only 3 UI features use the server:
  1. Live market price fetch (NSE/Upstox)
  2. Audit trail persistence
  3. Research workspace sync

---

## Proposed Architecture: Hybrid Local-First

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (Vite dev server or static build)                       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  React App (100% of computation)                          │   │
│  │  - Parser, Engine, Valuation, Charts, Export              │   │
│  │  - IndexedDB for local persistence (audit, workspace)     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                          │ fetch("/api/...")                      │
│                          ▼                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Local API Server (Express/Hono, ~100 lines)              │   │
│  │  - Market data proxy (NSE, bypasses CORS)                 │   │
│  │  - Audit/research → local filesystem (~/.penman-data/)    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Option A: Pure Browser (Zero Server)

**How it works:**
- Run `vite dev` or open the built `dist/index.html`
- Market data: manual input only (no live NSE — CORS blocks it from browser)
- Audit: IndexedDB in browser (persists across sessions, no cloud)
- Research workspace: IndexedDB or localStorage

**Pros:**
- Zero dependencies beyond `npm run dev`
- Works offline
- No secrets needed
- Portable — just open the HTML file

**Cons:**
- No live NSE price feed (must enter manually)
- Audit data lives in browser only (lost if you clear storage)
- No cross-device sync

**Effort:** 1 day — swap `fetch("/api/...")` calls with IndexedDB fallbacks

---

## Option B: Local Express Server (Recommended)

**How it works:**
- `npm run dev` starts both Vite + a local Express server on port 3001
- Vite proxies `/api/*` to the local server
- Market data: local server fetches NSE directly (no CORS issue server-side)
- Audit: writes JSON files to `~/.penman-data/audit/`
- Research: writes JSON files to `~/.penman-data/research/`

**Pros:**
- Full feature parity with Vercel deployment
- Live NSE prices work (server-side fetch, no CORS)
- Data persists on disk (survives browser clear)
- No cloud account needed
- No secrets needed for basic use (NSE is public)
- Can still deploy to Vercel for sharing/mobile access

**Cons:**
- Needs Node.js running locally
- Data stays on one machine (no sync)

**Effort:** 2 days

**File structure:**
```
server/
  index.ts              ← Express app (~80 lines)
  routes/
    marketData.ts       ← NSE/Upstox proxy (reuse existing logic)
    audit.ts            ← fs-based audit store
    research.ts         ← fs-based research store
  store/
    fsStore.ts          ← read/write JSON to ~/.penman-data/
```

**package.json changes:**
```json
{
  "scripts": {
    "dev": "concurrently \"vite\" \"tsx server/index.ts\"",
    "dev:local": "tsx server/index.ts & vite --open",
    "build": "vite build",
    "start:local": "node dist-server/index.js & npx serve dist"
  }
}
```

**vite.config.ts proxy:**
```ts
server: {
  proxy: {
    '/api': 'http://localhost:3001'
  }
}
```

---

## Option C: Electron / Tauri Desktop App

**How it works:**
- Package the Vite app + local server into a desktop executable
- Single `.exe` / `.app` — double-click to run
- All data stored in app data folder

**Pros:**
- True desktop app experience
- No terminal/Node.js knowledge needed
- Auto-updates possible
- Can access filesystem directly (no CORS at all)

**Cons:**
- Significant packaging overhead (Electron = 150MB+, Tauri = 10MB)
- Build pipeline complexity
- Overkill for a single-user research tool

**Effort:** 5 days (Tauri) or 3 days (Electron)

---

## Recommendation: Option B (Local Express)

Reasons:
1. You already have Node.js (you run `npm run dev` daily)
2. Full NSE live price support without any cloud
3. Audit trail persists on disk — no data loss
4. Zero cost (no Vercel, no API keys for basic NSE)
5. Can still deploy to Vercel when you want to share or access from phone
6. Minimal code change — the React app doesn't change at all, only the backend swaps

---

## Implementation Plan

### Phase 1: Local filesystem store (replaces @vercel/blob)
- `server/store/fsStore.ts` — CRUD for JSON files in `~/.penman-data/`
- Drop-in replacement for `@vercel/blob` get/put/list/del

### Phase 2: Local Express server
- `server/index.ts` — Express with CORS, JSON body parser
- `server/routes/marketData.ts` — copy NSE logic from `api/market-data/snapshot.js`
- `server/routes/audit.ts` — events/runs/uploads using fsStore
- `server/routes/research.ts` — workspace using fsStore

### Phase 3: Vite proxy config
- Add proxy rule in `vite.config.ts`
- Add `dev:local` script to package.json
- Test full flow: upload ZIP → dashboard → live NSE price → audit persists

### Phase 4: Graceful degradation
- If local server is down, app still works (manual price, no audit)
- `useLiveMarketData` hook already handles fetch failures gracefully
- Add a small banner: "Local server not detected — running in offline mode"

### Phase 5: Production local build
- `npm run build` produces `dist/` (static frontend)
- `npm run build:server` produces `dist-server/` (compiled Express)
- `npm run start:local` serves both from one command
- Optional: single `start.bat` / `start.sh` for one-click launch

---

## Data Storage Layout (local)

```
~/.penman-data/
  audit/
    runs/
      <runId>.json          ← run metadata
    events/
      <runId>/
        <eventId>.json      ← individual audit events
    uploads/
      <runId>/
        <filename>.zip      ← original Capitaline ZIPs
  research/
    workspaces/
      <companyId>.json      ← workspace state
    profiles/
      <companyId>.json      ← company profile
  market-cache/
    <symbol>-<date>.json    ← cached NSE responses (avoid re-fetching)
```

---

## Migration Path

The beauty: **nothing breaks**. Both modes coexist:

| Scenario | What happens |
|----------|-------------|
| `npm run dev` (current) | Vite + Vercel dev server (if configured) |
| `npm run dev:local` (new) | Vite + local Express, no cloud |
| Deployed on Vercel | Works exactly as today |
| Built + served locally | `npm run start:local`, zero cloud |

The React app code is identical in all cases — only the `/api/*` backend differs.

---

## Summary

| Question | Answer |
|----------|--------|
| Can it run fully local? | **Yes** |
| Does the engine need a server? | **No** — 100% browser |
| What needs a server? | Only: NSE price proxy, audit persistence |
| Simplest local option? | Option A: just use manual prices, skip audit |
| Best local option? | Option B: tiny Express server (~100 lines) |
| How much work? | 2 days for full local parity |
| Does it break Vercel? | No — both modes coexist |
