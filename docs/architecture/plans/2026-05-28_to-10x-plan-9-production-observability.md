# Plan 9 — Production Observability, Immutable Audit Log, DR (4 PRs)

> **For Hermes:** Use `subagent-driven-development` skill. This plan turns the deployment from "single Vercel project with localStorage" into "production-grade SaaS with APM, append-only audit log, automated backups, load-tested for 1K concurrent users".

**Goal:** Make the system observable, recoverable, and forensically auditable — the operational requirements a regulated buyer (SEBI / institutional asset manager) will ask before signing.

**Architecture:**
1. APM via Sentry + OpenTelemetry traces
2. Append-only event log via KV stream + nightly archival to `@vercel/blob`
3. Disaster recovery: automated daily KV → blob backup; documented restore drill
4. Performance baseline + load test via k6

**Tech Stack:** `@sentry/react`, `@sentry/node`, `@opentelemetry/api` + Vercel native trace integration. `k6` for load tests (run from `scripts/`).

**Sequencing rule:** PR-9.1 (APM) first because every other PR's verification depends on telemetry. Others independent after.

---

## PR-9.1 — APM: Sentry + OpenTelemetry traces

**Branch:** `obs/sentry-otel-foundation`
**Estimated diff:** +600 / -50, 3 new files

**Why:** Today, errors that happen in a user's browser disappear. A failed Capitaline parse, a KV read timeout, a React render crash — none surface to the team. The trace logger writes to localStorage; nobody reads it. Production observability requires a centralized capture.

**Steps:**

1. Add `@sentry/react` for browser, `@sentry/node` for Vercel functions.
2. Sentry initialization:
   ```ts
   // src/lib/observability/sentry.ts
   import * as Sentry from "@sentry/react";

   export function initSentry() {
     if (!import.meta.env.VITE_SENTRY_DSN) return;
     Sentry.init({
       dsn: import.meta.env.VITE_SENTRY_DSN,
       environment: import.meta.env.MODE,
       tracesSampleRate: 0.1,        // 10% of transactions
       replaysSessionSampleRate: 0,   // off; opt-in only
       replaysOnErrorSampleRate: 1.0, // capture replay on errors
       beforeSend(event) {
         // Strip PII / financial data from breadcrumbs
         return scrubFinancialData(event);
       }
     });
   }

   export function captureWithContext(error: Error, ctx: { runId?: string; companyId?: string; userId?: string }) {
     Sentry.withScope((scope) => {
       if (ctx.runId) scope.setTag("runId", ctx.runId);
       if (ctx.companyId) scope.setTag("companyId", ctx.companyId);
       if (ctx.userId) scope.setUser({ id: ctx.userId });
       Sentry.captureException(error);
     });
   }
   ```
3. PII scrubber: strip raw_metric_values, named entities (company names → companyId only), email/phone patterns.
4. Wire `captureWithContext` into:
   - Top-level React error boundary
   - All fetch/KV calls in `kvClient.ts`
   - Capitaline parser failures
   - Valuation-engine exceptions
5. Add OpenTelemetry traces for:
   - Pipeline stages (recast, ratios, anomaly, valuation) with stage-name + ms duration
   - KV calls with key + ms
   - API route handlers with route + status
6. Build APM dashboard config in `docs/observability/sentry-dashboards.md`: error rate by route, p99 KV latency, slowest pipeline stages, top failing companies.
7. Tests: 8 cases — Sentry init no-op when DSN missing, PII scrubbing for raw_metric_values, OTel span lifecycle, error boundary capture.

**Acceptance test:**

```bash
# Local: trigger error, verify Sentry receives it
VITE_SENTRY_DSN=https://test@example.sentry.io/1 npm run dev
# Click "force error" debug button → check Sentry inbox

npx vitest run src/lib/observability/   # 8 green
```

---

## PR-9.2 — Immutable append-only event log

**Branch:** `obs/append-only-event-log`
**Estimated diff:** +900 / -100, 4 new files

**Why:** For SOX/SEBI-style forensic audit, every state change in the system needs a permanent record. KV is mutable; localStorage is volatile. Need an append-only log that survives even if the KV is wiped.

**Domain spec:**

Every meaningful state change emits an event:
- Audit run created / updated / signed-off / archived
- Annotation added / replied / status-changed
- Comparison registry mutated
- Schema migration occurred
- Feature flag toggled (admin action)
- Login / logout (auth events)

Event format:
```ts
interface AuditEvent {
  eventId: string;                 // UUID
  timestamp: string;               // ISO
  actor: { userId: string; displayName: string; role: "user" | "admin" | "system" };
  eventType: string;               // e.g. "audit-run.signed-off"
  resourceType: string;            // e.g. "audit-run"
  resourceId: string;              // e.g. runId
  payload: unknown;                // event-specific data
  prevHash: string;                // previous event hash — chain
  hash: string;                    // SHA-256 of (eventId|timestamp|actor|eventType|resourceId|payload|prevHash)
}
```

Storage:
- Hot: KV stream `penman:events:hot` (append-only, capped at 10K events; older flush nightly)
- Cold: `@vercel/blob` archive `penman/events/<YYYY-MM>.jsonl.gz` — daily flush, monthly aggregation, 7-year retention
- Verifiability: chained hashes mean tampering is detectable (any modification breaks the chain from that point forward)

**Steps:**

1. Implement event log writer in `src/lib/observability/eventLog.ts`.
2. Wire emitters at every state-change site (use middleware pattern in API routes).
3. Build cold-archive daily cron (Vercel Cron) that flushes hot events to `@vercel/blob`.
4. Build chain-verification script `scripts/verify-event-chain.cjs` — walks events, recomputes hashes, asserts continuity.
5. Build admin UI surface (gated by role): event-log viewer with filters by actor, resource, timestamp, eventType.
6. Tests: 14 cases — chain integrity, hash determinism, replay attack detection, role-gated emission, cold archive round-trip.

**Acceptance test:**

```bash
# Append events, verify chain
node scripts/verify-event-chain.cjs   # exit 0

# Tamper test: modify an event in cold archive
node scripts/tamper-test.cjs          # exit 0 (test confirms tamper IS detected)

npx vitest run src/lib/observability/__tests__/eventLog.spec.ts   # 14 green
```

---

## PR-9.3 — Disaster recovery: automated KV backups + restore drill

**Branch:** `obs/disaster-recovery`
**Estimated diff:** +500 / -50, 2 new scripts, 1 runbook

**Why:** Vercel KV is durable, but "durable" ≠ "recoverable from operator error". A user accidentally deletes a critical comparison registry, an admin runs a `kv flushdb`, a region outage takes the cluster down. Without a backup, that's data loss.

**Steps:**

1. Build daily backup cron:
   ```ts
   // api/cron/kv-backup.ts (called by Vercel Cron daily at 02:00 UTC)
   import { kv } from "@vercel/kv";
   import { put } from "@vercel/blob";

   export default async function handler() {
     const keys = await scanAllKvKeys("penman:*");
     const dump: Record<string, unknown> = {};
     for (const key of keys) dump[key] = await kv.get(key);
     const filename = `kv-backup/${new Date().toISOString().slice(0, 10)}.json.gz`;
     const compressed = gzipSync(Buffer.from(JSON.stringify(dump)));
     await put(filename, compressed, { access: "private", contentType: "application/gzip" });
     return new Response(JSON.stringify({ ok: true, keys: keys.length, filename }));
   }
   ```
2. Retention: 30 daily, 12 monthly, 7 yearly (lifecycle managed by `@vercel/blob` rules).
3. Build restore script `scripts/restore-from-backup.cjs`:
   - Lists available backups
   - Prompts for confirmation (high-risk action)
   - Reads backup, walks keys, writes to KV with `--dry-run` mode
4. Documented restore drill in `docs/operations/disaster-recovery-runbook.md`:
   - Quarterly drill: pick a backup, restore to a separate test KV namespace, verify integrity
   - Drill log signed by ops lead + reviewer
5. Add Sentry alert: backup cron failure → P1 alert.
6. Tests: 8 cases — backup round-trip, key integrity preserved, gzip correctness, restore dry-run idempotency, partial-restore safety.

**Acceptance test:**

```bash
# Trigger backup manually
curl -X POST $PROD_URL/api/cron/kv-backup -H "Authorization: Bearer $CRON_SECRET"
# Returns { ok: true, keys: N, filename: "..." }

# Verify blob exists
vercel blob ls kv-backup/   # most recent file appears

# Restore drill
node scripts/restore-from-backup.cjs --backup=2026-05-28 --target=test-namespace --dry-run
# Reports planned writes, no actual mutation
```

---

## PR-9.4 — Load testing + performance baseline

**Branch:** `obs/load-test-baseline`
**Estimated diff:** +400 / -50

**Why:** Today there's no answer to "what happens at 1K concurrent users / 10K audit runs / 50K residual entries per company". Without load test, capacity decisions are guesses.

**Steps:**

1. Install `k6` (binary, not npm; CI-side install).
2. Write `tests/load/scenarios/`:
   - `concurrent-list-runs.js` — 1K virtual users hitting `/api/kv/audit-runs/index`
   - `pipeline-throughput.js` — 100 VUs each running a full pipeline build (rawData → envelope)
   - `kv-stress.js` — 10K key writes followed by 10K reads
3. Each scenario asserts:
   - p99 latency < threshold (defined per route)
   - Error rate < 0.1%
   - Throughput meets baseline
4. Document baselines in `docs/observability/performance-baseline.md` so regressions are detectable.
5. Run k6 quarterly via GitHub Action (manual trigger; not on every PR — too expensive).
6. Sentry transactions during load test capture real-world distribution; cross-reference with k6 client-side metrics.

**Acceptance test:**

```bash
k6 run tests/load/scenarios/concurrent-list-runs.js
# p99 latency < 500ms
# Error rate < 0.1%
# Throughput ≥ 200 RPS
```

---

## Cross-cutting acceptance for Plan 9

```bash
# ─── APM wired ─────────────────────────────
grep -rn "Sentry\.init\|captureWithContext" src/ | wc -l   # ≥ 5
curl -I $PROD_URL/api/health | grep "x-sentry-environment"   # present

# ─── Event log integrity ──────────────────
node scripts/verify-event-chain.cjs   # exit 0
ls vercel-blob://penman/events/   # daily archives

# ─── Backup automated ─────────────────────
ls vercel-blob://kv-backup/   # last 30 days present

# ─── Load test baselines documented ────────
ls docs/observability/performance-baseline.md
ls tests/load/scenarios/   # ≥ 3 scenarios

# ─── Restore drill in runbook ────────────
ls docs/operations/disaster-recovery-runbook.md
grep "Quarterly restore drill" docs/operations/disaster-recovery-runbook.md   # present

# ─── Sentry alerts configured ─────────────
# Manual: alert rules visible in Sentry project for: error spike, p99 latency, backup failure
```

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Sentry sample rate too low → miss low-frequency bugs | medium | Per-route override: KV route 100%, pipeline route 10%, generic 1% |
| Event log fills KV faster than archive can flush | medium | Hot store cap at 10K; if reached, oldest events flushed synchronously and archived. Telemetry alerts when cap pressure > 80% |
| Backup file size grows unbounded | medium | Per-month aggregation; daily files older than 30 days collapsed into monthly. 7-year retention enforced via blob lifecycle |
| Load test cost on production-equivalent infra | high | Run k6 against preview deploys, not production. Quarterly cadence, not continuous |
| Restore drill never actually executed | high | Quarterly calendar reminder; restore drill is a quarterly-review checkbox on the engineering calendar |
| Chain hash break is unrecoverable evidence | medium | Append-only log expectation: if a hash break is detected, log the break itself as an event with full forensic context. Don't mutate to fix |

## Definition of done

10/10 means:
1. Every production error surfaces in Sentry with run/company/user context within 30s
2. Every state change is logged, hash-chained, and archived to immutable blob storage
3. Backups happen automatically daily; restore drill is documented and quarterly
4. Performance baselines are published; regressions are detectable
5. A SEBI auditor or SOX reviewer can be handed: (a) Sentry access for incident history, (b) event log archives for state change history, (c) backup history for recoverability, (d) load test reports for capacity. They sign off without follow-up questions.
