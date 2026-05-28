# Backup & Disaster Recovery Runbook

Plan 9 PR-9.3.

This runbook describes how Penman V2 Analysis backs up production data and how to drill recovery quarterly.

## Backup Policy

Per scope:

| Scope                  | Frequency | Retention | Store          |
|------------------------|-----------|-----------|----------------|
| audit-runs             | daily     | 90 days   | Vercel Blob    |
| comparison-registries  | daily     | 90 days   | Vercel Blob    |
| residuals              | daily     | 90 days   | Vercel Blob    |
| annotations            | daily     | 365 days  | Vercel Blob    |
| locked-evidence        | hourly    | forever   | Vercel Blob    |
| event-log              | hourly    | 7 years   | Vercel Blob    |

Implemented in `src/lib/backupScheduler.ts` (`POLICIES` constant). Worker function (`api/cron/snapshot.js`) is the follow-up to PR-9.3 that wires the pure scheduler to Vercel Cron + KV scan + Blob write.

## Quarterly Restore Drill

Schedule: first Monday of Jan / Apr / Jul / Oct, 10:00 IST.

### Pre-drill checklist
- [ ] Notify on-call (24h prior) that restore drill is happening
- [ ] Confirm a non-prod restore environment is provisioned
- [ ] Confirm the most recent snapshot per scope exists in Blob
- [ ] Confirm event-log chain integrity (`verifyChain` returns valid)

### Drill steps
1. Pick a non-prod KV namespace as the restore target
2. Fetch the most recent snapshot for each scope from Blob
3. For each scope, verify SHA-256 against the snapshot's index entry
4. Replay each snapshot into the restore KV namespace
5. Run the regression test suite against the restore endpoint
6. Run `verifyChain` against the restored event-log
7. Compute mean restore time per scope (target: < 10 minutes per scope)
8. File a drill report in `docs/dr-drills/<YYYY-Q>.md`

### Failure modes & responses

| Failure | Detection | Response |
|---------|-----------|----------|
| Snapshot missing | Step 2 returns 404 | Fall back to prior day's snapshot, file P1 incident |
| Hash mismatch | Step 3 fails | Snapshot was corrupted in transit; restore from prior snapshot, file P0 incident |
| Replay fails | Step 4 returns error | Inspect raw payload, run schema migrations via `migrateEnvelope` |
| Chain broken | Step 6 returns brokenAt >= 0 | Forensic analysis on the broken segment; file P0 incident |
| Restore time > 10 min | Step 7 | Optimize replay batching in next sprint; document baseline |

### Post-drill
- [ ] Tear down restore namespace
- [ ] Update this runbook with any new failure modes
- [ ] Share drill report in #ops channel
