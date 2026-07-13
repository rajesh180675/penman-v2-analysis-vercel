# Audit, Production, and Scenario Hardening — Implementation Report

**Date:** 2026-07-12 (IST)
**Architecture posture:** Principal-architecture completion record
**Scope:** Audit transport performance, CI execution, artifact operations, local acceptance, and scenario valuation governance

## Outcome

The post-greenfield hardening batch is implemented. Large analysis snapshots are prepared by a dedicated browser worker; production and local artifact paths verify content integrity; retention health is visible to the reviewer; validation is distributed across CI jobs with per-test timing evidence; and scenario valuation now publishes an explicit eligibility decision separating a defensible range from an uncalibrated probability-weighted point estimate.

## Delivered design

### 1. Non-blocking audit snapshot transport

- `auditSnapshot.worker.ts` performs JSON serialization, SHA-256/FNV fallback hashing, gzip compression, and compact-event sizing outside the React thread.
- `auditSnapshotWorkerClient.ts` owns request correlation, worker failure handling, and deterministic direct fallback for tests/SSR.
- `useAuditPersistence` debounces changes, discards stale generations, deduplicates by content hash, uploads the full content-addressed artifact, and posts only the bounded event projection.
- The production build emits the audit worker as an independent 7.86 KB asset.

### 2. Parallel release validation and timing evidence

- GitHub Actions now runs quality/build, three standard test shards, golden valuation cases, and three company-audit shards as independent jobs.
- Each standard shard emits JUnit timing data and a Markdown summary of its 25 slowest tests.
- A final release-gate job fails unless every parallel job succeeds.
- Local `validate` remains available; CI no longer serializes the complete release program through one runner.

### 3. Production artifact and lifecycle integration

- The private Vercel Blob artifact handler is covered at the HTTP-handler boundary for capability authorization, gzip decoding, hash verification, parsed summary, byte-identical download, and unauthorized rejection.
- The deployed pruning handler is covered for per-run expiry and eventless orphan deletion.
- Local lifecycle cleanup retains its hourly opportunistic policy and now exposes the most recent cleanup report.
- Production inspector payloads report scheduled-cron health and any expired blobs still visible pending cleanup.

### 4. Reviewer-facing Run Inspector automation

- The newest analysis snapshot artifact is verified automatically once per selected run/path.
- Manual re-verification and raw stored-byte download remain available.
- Governance and Recovery shows cleanup mode, status, last check, and a summary of expired runs/artifacts/orphan directories.
- Integrity mismatch and invalid compression remain fail-visible rather than being represented as healthy.

### 5. TCS operational acceptance contract

- A Playwright acceptance test opens the exact deep link `?rf=7.00&erp=6.00&tab=upload&dark=0&company=TCS`.
- It requires immutable analysis-run publication, opens Runs, waits for automatic artifact verification, confirms retention health, and fails on any audit `413` response.
- The real 15-period TCS transport gate now prepares the actual artifact as well as checking the compact-event budget.

### 6. Scenario valuation governance

- `ScenarioGovernanceReport` is materialized into the immutable analysis run and stored as a content-addressed evidence artifact.
- It verifies scenario validation/order, assumption resolution and intrinsic-confidence eligibility, scenario value availability, synthesis defensibility, calibrated probability count, and probability sum.
- An ordered low/base/high scenario band can remain range-eligible when evidence is adequate.
- A probability-weighted point estimate is withheld unless every computed case has calibrated probabilities summing to one and synthesis defensibility is confirmed.
- The run-backed Forecast surface displays status, range eligibility, point-estimate eligibility, the low/base/high band, provenance coverage, and calibration coverage.

## Verification record

| Gate | Result |
|---|---|
| TypeScript | Passed |
| Focused audit/production/scenario batch | 9 files; 18 tests passed after fixture correction |
| Executor and Forecast integration | 3 files; 18 tests passed |
| Real TCS 15-period snapshot/artifact budget | Passed in 63.26 seconds |
| Production build | Passed; 1,422 modules; audit worker emitted separately |
| Bundle budget | Passed; 73 chunks; 1,416.8 KB total gzip |
| JavaScript syntax and diff whitespace | Passed |

The Windows workspace repeated its known esbuild pre-collection directory-access error for the timed shard command. This occurs before Vitest loads the configuration or collects tests; the same focused suites run successfully through `npm test -- <files>`. Linux CI owns the new timed matrix execution.

The focused Playwright TCS command reached the outer six-minute tool limit without emitting a completed test result. The test itself is committed and bounded at four minutes once Playwright reaches the test body; it should be run from a normal local terminal with `npm run test:e2e:tcs-audit` after ensuring no stale dev-server instance owns ports 5173/3001.

## Operational handoff

1. Stop existing local Vite/API processes.
2. Run `npm run dev:local`.
3. Open the exact TCS deep link.
4. Open Runs and confirm `Integrity: verified` and a healthy/scheduled retention state.
5. Confirm the API console contains no `413 Payload Too Large` response.
6. Run `npm run test:e2e:tcs-audit` for the repeatable browser acceptance contract.

## Remaining external dependencies

No repository code can prove deployed Vercel scheduling or object-store lifecycle execution without a deployment. Production verification still requires configured `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, a successful Vercel deployment, and observation of at least one scheduled prune invocation. Those are environment/deployment activities, not missing repository implementation.
