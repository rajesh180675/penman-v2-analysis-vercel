# Plan 4 — Multi-Tenant Persistence (4 PRs, no schema bump)

> **For Hermes:** Use `subagent-driven-development` skill. This plan moves Penman from "single-analyst-on-localStorage" to "multi-analyst-on-Vercel-KV". Treat as ops-critical — staged rollout with read-shadow then promote-to-canonical.

**Goal:** Make every persisted artifact visible across devices, browsers, and analysts working in the same firm. Today, an audit run on Browser A is invisible to Browser B even on the same logged-in account.

**Architecture:** Three-tier with explicit consistency model:

```
┌────────────────────────────────────────────────────────────────┐
│ Tier 1 (canonical):  Vercel KV (Redis-style)                  │
│ Tier 2 (cache):      localStorage with TTL                    │
│ Tier 3 (offline):    indexedDB sync queue                     │
└────────────────────────────────────────────────────────────────┘

Reads:  Tier 2 (fast) → falls through → Tier 1 (slow but canonical) → Tier 3 (offline only)
Writes: Tier 1 + Tier 2 (write-through) + Tier 3 (queue if offline)
```

**Consistency:** "Read-your-writes" within a session. "Eventual consistency" across analysts (KV propagation < 1s in practice).

**Tech Stack:** `@vercel/kv` (already a transitive dep candidate; verify), `@vercel/blob` already present.

**Sequencing rule:** PR-4.1 (KV setup + per-user identity) MUST land first because every other PR depends on user identity. PR-4.2/4.3/4.4 can land in any order after that.

---

## PR-4.1 — Vercel KV foundation + per-user identity

**Branch:** `persistence/kv-foundation`
**Estimated diff:** +900 / -100, 3 new API routes, 4 new files

**Why:** Today there's no `userId`. Every artifact is keyed `penman.<thing>.v1`. With multi-tenancy that becomes `penman.<userId>.<thing>.v1`. We need a stable user identity before doing anything else.

**Decisions:**

| Question | Answer | Rationale |
|---|---|---|
| Where does identity come from? | Vercel SSO + JWT | Zero-config on Vercel; falls back to anonymous-with-cookie-pinned UUID for local-dev |
| What's the canonical store? | Vercel KV | Same vendor as the deploy target; sub-50ms p99; per-key TTLs |
| Migration path for existing users? | Implicit; on first read, fetch from localStorage and write to KV | Zero-touch UX |

**Target layout:**

```
api/
  identity/
    me.ts                       ← GET → { userId, email, displayName }
  kv/
    audit-runs/
      [runId].ts                ← GET/PUT/DELETE for one run
      index.ts                  ← GET (list) / POST (new)
    comparison-registry.ts      ← GET/PUT
    residuals/
      [companyId].ts            ← GET (list)
      [companyId]/[runId].ts    ← PUT (append entry)

src/lib/
  identity/
    useIdentity.ts              ← hook returning user, with anon-fallback
  persistence/
    kvClient.ts                 ← thin fetch wrapper, retry, telemetry
    cacheLayer.ts               ← localStorage TTL cache
    syncQueue.ts                ← indexedDB queue for offline writes
    __tests__/
      kvClient.spec.ts
      cacheLayer.spec.ts
      syncQueue.spec.ts
```

**KV key schema:**

```
penman:audit-run:<userId>:<runId>                    → JSON envelope (audit run snapshot)
penman:audit-run-index:<userId>                      → list of runIds, sorted by created_at desc
penman:comparison:<userId>:<comparisonId>            → comparison registry entry
penman:residuals:<userId>:<companyId>                → list of residual summaries (newest last)
penman:user:<userId>:settings                        → user preferences
```

**Steps:**

1. Add `@vercel/kv` to `dependencies`.
2. Provision Vercel KV: `vercel kv create penman-prod`. Store URL + token in Vercel env (`KV_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`).
3. Write `api/identity/me.ts`:
   ```ts
   import { getServerSession } from "@vercel/auth";
   export default async function handler(req, res) {
     const session = await getServerSession(req);
     if (session) {
       return res.json({ userId: session.user.id, email: session.user.email, displayName: session.user.name });
     }
     // Anonymous fallback: cookie-pinned UUID
     let anon = req.cookies.penman_anon;
     if (!anon) {
       anon = `anon-${crypto.randomUUID()}`;
       res.setHeader("Set-Cookie", `penman_anon=${anon}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
     }
     return res.json({ userId: anon, email: null, displayName: "Anonymous" });
   }
   ```
4. Build `kvClient.ts`:
   ```ts
   import { kv } from "@vercel/kv";
   import { trace } from "../traceLogger";

   export async function kvGet<T>(key: string): Promise<T | null> {
     const t0 = performance.now();
     try {
       const v = await kv.get<T>(key);
       trace("config", "kvGet", { key, ms: performance.now() - t0, hit: v !== null });
       return v;
     } catch (e) {
       trace("error", "kvGet:failure", { key, error: String(e) });
       return null;   // fail-open; cacheLayer will fall through to localStorage
     }
   }
   export async function kvSet<T>(key: string, value: T, ttlSec?: number) {
     const t0 = performance.now();
     try {
       if (ttlSec) await kv.set(key, value, { ex: ttlSec });
       else await kv.set(key, value);
       trace("config", "kvSet", { key, ms: performance.now() - t0 });
     } catch (e) {
       trace("error", "kvSet:failure", { key, error: String(e) });
       throw e;
     }
   }
   ```
5. Write `cacheLayer.ts` — localStorage with `penman.<userId>.<thing>.v1` keys + 5-minute TTL on reads.
6. Write `useIdentity.ts` returning `{ userId, email, displayName, isAnonymous }`.
7. Write 12 unit tests covering: KV success, KV failure → cache fallback, cache hit-fresh, cache hit-stale → KV refresh, anonymous user, sign-in → migration prompt.
8. Vercel Auth setup is a one-off — use anonymous mode for now if SSO blocks the rollout.

**Acceptance test:**

```bash
# Identity endpoint
curl http://localhost:3000/api/identity/me
# Returns { userId, email, displayName }

# KV write/read round-trip
node -e 'import("@vercel/kv").then(m => m.kv.set("test:key", "value").then(() => m.kv.get("test:key")).then(console.log))'
# "value"

npm test 2>&1 | tail -5    # 12 new tests pass
```

---

## PR-4.2 — Migrate audit runs to KV (per-user)

**Branch:** `persistence/audit-runs-kv`
**Estimated diff:** +500 / -200, 2 new API routes

**Why:** Audit run history is the most-accessed artifact. Cross-device visibility is the primary user value of Plan 4.

**Steps:**

1. Define schema for audit-run snapshot in KV:
   ```ts
   type StoredAuditRun = {
     userId: string;
     runId: string;
     companyId: string;
     companyName: string;
     createdAt: string;        // ISO
     createdBy: { userId: string; displayName: string };
     envelope: AnalysisTraceabilityEnvelope;
     valuation: ValuationResult;
     // ... other fields per existing audit snapshot
   };
   ```
2. Write `api/kv/audit-runs/index.ts` — `GET` returns the user's run index, `POST` appends a new run.
3. Write `api/kv/audit-runs/[runId].ts` — `GET`/`PUT`/`DELETE` for a single run.
4. Update `src/lib/audit.ts` to write through to KV via `kvSet`. localStorage stays as the cache.
5. On the audit run list UI, fetch from `/api/kv/audit-runs/index`. Show creator name (`createdBy.displayName`) for shared firm visibility.
6. **Migration:** on app boot, check if any localStorage runs exist that are NOT yet in KV. Push them with `createdBy = current user`. One-time migration; idempotent.
7. Test: 8 spec cases including migration, cache miss → KV fetch, write-through, list-by-user, delete propagation.

**Acceptance test:**

```bash
# Browser A creates a run, Browser B (same userId) lists runs and sees it
# (manual verification on preview deploy)
npx playwright test e2e/cross-browser-audit-runs.spec.ts

# Unit suite
npx vitest run src/lib/__tests__/audit.spec.ts   # green
```

---

## PR-4.3 — Promote comparison registry to KV

**Branch:** `persistence/comparison-registry-kv`
**Estimated diff:** +400 / -150

**Why:** Comparison registry is the per-firm peer-set artifact. It's the reason the user keeps comparing companies — currently rebuilt on every browser.

**Steps:**

1. KV key: `penman:comparison:<userId>:<comparisonId>`.
2. Update `src/lib/companyRegistrySnapshot.ts` to use `kvGet` / `kvSet` with localStorage cache.
3. Migration on first read: localStorage payload → KV write, with telemetry (`trace("config", "comparison:migration", ...)`).
4. **Important:** preserve the existing schema-version sanitizer. Stale-schema rejection still applies; KV doesn't change schema semantics.
5. Update `companyRegistryStore.spec.ts` with 4 new tests covering KV path.

**Acceptance test:**

```bash
npx vitest run src/lib/__tests__/companyRegistryStore.spec.ts   # 8+ tests green (was 4)
# Manual: comparison registry survives browser change
```

---

## PR-4.4 — Residuals dashboard cross-device

**Branch:** `persistence/residuals-cross-device`
**Estimated diff:** +500 / -100

**Why:** Plan v4 PR-G shipped residuals as localStorage-only. To use the residual-score downgrade gate as a true governance signal, residual history must aggregate across all analysts working on the same company.

**Steps:**

1. Update `src/lib/residualsStore.ts` to use `kvGet` / `kvSet`.
2. KV key: `penman:residuals:<userId>:<companyId>`.
3. **Cross-user view (new):** add `kvGet` for `penman:residuals:firm:<companyId>` — a firm-scoped union view. Each user write also appends to the firm key (eventual consistency, idempotent on `runId`).
4. New API route `api/kv/residuals/firm/[companyId].ts` returns the firm-scoped history.
5. Build a "residuals dashboard" surface in DebugPanel: time-series of `overallResidualScore` for the active company, color-coded by analyst, with the production-ready threshold line at score=40.
6. 6 new unit tests covering firm-scoped union, idempotent appends, eviction policy preserved.

**Acceptance test:**

```bash
npx vitest run src/lib/__tests__/residualsStore.spec.ts   # 16+ tests (was 10)
# Manual: dashboard shows multi-analyst residual time-series
```

---

## Cross-cutting acceptance for Plan 4

```bash
# ─── KV is the canonical store ────────────────
grep -rn "kvGet\\|kvSet" src/lib/ | wc -l    # ≥ 20

# ─── Identity is wired ───────────────────────
curl localhost:3000/api/identity/me           # returns userId

# ─── localStorage is now a cache, not the source ──
grep -rn "localStorage" src/lib/persistence/cacheLayer.ts | wc -l   # used inside cacheLayer
grep -rn "localStorage.getItem\\|localStorage.setItem" src/lib/ --include="*.ts" \
  | grep -v "cacheLayer\\|test\\|spec" | wc -l   # = 0 (everywhere else uses cacheLayer)

# ─── Migrations ran ──────────────────────────
# Telemetry should show schemaMigration entries with comparison:migration / audit:migration

# ─── Suite green ─────────────────────────────
npm run validate
```

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Vercel KV latency spike degrades UX | medium | Cache layer covers reads. If cache is hot, KV failure is invisible. Add p99 latency alert on `trace("config", "kvGet")` |
| User loses connectivity mid-run | medium | syncQueue captures writes in indexedDB; flushes on reconnect with idempotent writes (keyed on runId). Never lose data |
| Two browsers race on same comparison registry | low | KV `kv.set` is last-write-wins. For comparison registry this is acceptable (analysts working in concert). For audit runs, runId is unique so no race |
| KV cost spirals | low | Per-user cap: 100 audit runs, 5MB residuals, 50 comparisons. Soft cap with warning at 80%. Hard reject at 100%. Telemetry per cap |
| Anonymous users → KV bloat | medium | Anonymous keys TTL 30 days. Authenticated keys never TTL |
| Migration loses local-only data | low | Migration is additive: localStorage entries pushed to KV, never deleted from localStorage in PR-4.x. Cleanup is a follow-up |

## Definition of done

10/10 means:
1. Two analysts in the same firm see each other's audit runs, comparison registries, and residual histories.
2. localStorage is a fast cache; KV is the source of truth.
3. Offline writes queue in indexedDB and flush on reconnect (idempotent).
4. Anonymous users still work; auth promotes their data atomically.
5. Per-user storage caps prevent runaway KV bills.
6. Telemetry visible: KV p50/p99 latencies, cache hit rates, migration counts.
