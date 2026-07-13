# Production Valuation Platform Implementation Report

**Date:** 2026-07-13
**Role:** Principal Architecture
**Repository:** `penman-v2-analysis`
**Status:** Repository-implementable platform scope completed and validated; live provider activation and reviewed real-world evidence remain explicit deployment prerequisites.

## 1. Executive outcome

This implementation wave moved the application from a browser-centric valuation tool toward a governed valuation platform built around immutable runs, content-addressed evidence, point-in-time controls, fail-closed model eligibility, workspace security, durable-storage ports, and operational recovery.

The codebase now has enforceable contracts for:

- authenticated workspace authorization and distributed rate limiting;
- immutable AnalysisRun persistence through a mandatory application-service security boundary;
- artifact reference-closure verification before run creation, finalization, or publication locking;
- permanent retention holds for evidence referenced by a locked run;
- PostgreSQL-compatible metadata migrations and object-storage ports;
- authenticated, atomic backup and restore verification;
- strict point-in-time market and scenario-calibration evidence;
- governed sector-sidecar onboarding for all 33 registered companies;
- advanced-model promotion and execution controls;
- immutable-run-backed portfolio comparison and allocation;
- deployment health, telemetry, CI, and full-repository validation.

This is not represented as a completed production deployment. Concrete PostgreSQL and private Vercel Blob adapters, atomic lifecycle/outbox transactions, strict OIDC verification, authenticated serverless routes, scheduled backup/restore/outbox jobs, and live fail-closed probes are now implemented. Supplying managed-provider credentials, identity-tenant configuration, reviewed calibration/sidecar/promotion evidence, and executing a real backup/restore drill still require external systems or human review that are not present in this repository.

## 2. Architectural decisions implemented

### 2.1 Immutable run and evidence boundary

`AnalysisPlatformServiceV1` is now the mandatory boundary for run, artifact, event, and lock operations. Every method authorizes an explicit workspace permission. Local mode uses an intentionally named `LocalOnlyPlatformSecurityBoundary`; production callers cannot silently fall back to local trust.

Before a run is created, finalized, or locked, the service traverses the complete run reference graph:

- fact, policy, and model-catalog references;
- family, analysis-window, market, assumption, synthesis, and publication references;
- forecast and model-result references;
- stage input, output, evidence, and diagnostic references;
- gate and gate-check evidence references.

Each artifact is read and hash-verified through the artifact repository. Missing, corrupt, or cross-issuer references fail closed. Operation stamps and derived audit-event idempotency keys are validated before mutable repository work begins.

Publication locking applies a permanent retention hold to the verified reference set. Expiration purge cannot remove held evidence.

### 2.2 Security and tenancy

The platform security layer now contains:

- workspace membership and RBAC contracts;
- explicit permissions for run, artifact, publication, and administrative operations;
- server-session rejection at the local-only boundary;
- an atomic distributed rate-limit abstraction;
- SQL-backed membership and rate-limit adapters;
- a workspace security boundary combining authorization and rate limiting.

Every storage operation remains scoped by organization and workspace identifiers. The health endpoint is `no-store` and requires its token in production or whenever a health token is configured.

### 2.3 Durable persistence and migrations

The durable platform package defines provider-neutral ports for:

- PostgreSQL-compatible transactions;
- content-addressed object storage;
- AnalysisRun, artifact, run-operation, membership, and rate-limit repositories.

Migrations define workspace-scoped tables for runs, idempotency receipts, artifact metadata, audit events, publication locks, memberships, rate limits, scenario vintages, backup manifests, and artifact retention holds.

Migration execution now uses:

- a migration ledger with checksums;
- parameterized ledger inserts;
- a PostgreSQL advisory transaction lock;
- upgrade handling for the pre-checksum migration ledger;
- relational foreign keys from events and locks to their run;
- durable artifact-hold foreign keys with restrictive deletion.

The application service does not import a database or object-store SDK. Provider implementations must satisfy the existing domain interfaces and health probes.

### 2.4 Point-in-time market evidence

Run `asOf` now represents the analysis knowledge cutoff, rather than being incorrectly equated with the latest financial-statement period. The statement period remains available in the analysis window and traceability envelope.

Validation rejects:

- invalid or future raw financial periods;
- market prices or rates without a pinned date;
- market observations after run `asOf`;
- future or invalid market-history points;
- calibration cutoffs after run `asOf`;
- mixed-issuer raw inputs or issuer metadata mismatch.

Manual and provider-fallback market values are explicitly stamped at the instant they became known. They remain labelled fallback evidence; the timestamp does not convert them into vendor-sourced observations.

### 2.5 Scenario calibration and vintage governance

The scenario-calibration package includes:

- immutable point-in-time observation storage;
- strict `availableAt`, `forecastAsOf`, and `realizedAt` filtering;
- family, regime, and horizon binding;
- duplicate-observation rejection/degradation;
- probability-vector and policy-domain checks;
- Brier score and benchmark skill evaluation;
- Dirichlet smoothing;
- confidence intervals calculated on the same smoothed pseudo-count basis;
- separate look-ahead and invalid-record exclusion counts;
- evidence references and explicit reason codes.

Calibration changes participate in the browser coordinator fingerprint, so changing a calibration corpus or policy necessarily creates a new run. A binding mismatch between the supplied calibration report and the run family, horizon, or cutoff is a forecast blocker, not a silent no-op.

### 2.6 Sector-native valuation governance

The sector-case registry and onboarding manifest cover all 33 registered issuers with an explicit state:

- `ready` only with a current approved sidecar and complete evidence;
- `requires-sidecar` where a native case applies but evidence is absent;
- `not-applicable` where no governed native case applies;
- `blocked` for invalid, rejected, stale, ambiguous, or incomplete evidence.

Sidecar selection is deterministic by review timestamp. A later rejection supersedes an earlier approval independent of input order. Duplicate sidecar identifiers and ambiguous review ordering fail closed.

Economic validation now enforces finite, positive discount rates and valid discount-growth spreads. The NBFC funding case has its own catalog identity, `sector.nbfc.funding-justified-pb`, rather than incorrectly publishing a one-stage justified-P/B output as the separate seven-year ROA/leverage residual-income model.

### 2.7 Advanced-model governance

Advanced-model promotion requires:

- an exact dossier/catalog model match;
- a genuinely wired catalog implementation and a matching dossier assertion;
- at least one reviewed real-issuer golden case;
- minimum fact coverage and complete guard/lineage coverage;
- valid calibration evidence or a governed `not-required` decision;
- two distinct, nonblank reviewers;
- nonblank content-addressed promotion evidence.

Deprecated models cannot be promoted. Existing experimental, catalog-not-wired models remain blocked from production promotion.

Governed execution validates sidecar status, evidence, transformation lineage, dates, domains, output finiteness, and model identity. ESG inputs require exactly one score/bucket path, bounded overrides, and a positive cost-of-equity output. FX periods must be unique, ordered, and no later than run `asOf`. Model exceptions are converted to blocked results rather than escaping the governance boundary.

R&D real-options execution additionally declares its source monetary unit and share basis, producing an incremental equity adjustment in INR crore and INR per share. Anti-double-counting composition dossiers are immutable and workspace-scoped; reviewer identity comes from authenticated sessions, two distinct approvals with independent evidence are required, and any rejection vetoes approval. A candidate is generated only when the reviewed project-exclusion set exactly matches the sidecar, the named base model/case exists with evidence, approval predates the run cutoff, and the adjustment remains within its reviewed materiality cap.

The composition schema is now version 3 and binds each eligible catalog base model to its authoritative synthesis contribution and independence group. It also stores the SHA-256 identity of the exact reviewed advanced-model input, so changing an underlying value, development cost, probability, volatility, time horizon, bridge, or lineage after review invalidates resolution and production admission. AnalysisRun activation replaces that one exact base vote with the composed per-share value; it never adds an optionality contribution or another family vote. Activation fails closed on missing, ambiguous, cross-model, already-replaced, duplicate-dossier, value-bridge, input-hash, or lineage mismatches. The rebuilt range, aggregator model result, anti-tautology summary, synthesis artifact, and transformation DAG all carry the applied composition policy. The real-options model is therefore cataloged as implementation-wired while remaining experimental until real-issuer promotion evidence passes.

Production run admission does not trust that client artifact by shape alone. At create, finalize, and lock, the server reconstructs the exact promotion and composition decisions from the workspace-scoped SQL repository, using authenticated reviewer identities and all recorded vetoes. It requires an exact match among durable dossiers, reviews, promotion decision, composition policy, eligible candidate, and synthesis substitution trace. Forged reviewers, unknown hashes, cross-workspace records, later rejection, duplicate application, and candidate/trace mismatch are rejected before the run becomes authoritative. Local in-memory execution remains usable without pretending to provide this production authority boundary.

The authenticated application path is also wired. `PlatformGovernanceConnection` may provide issuer/as-of-bound advanced sidecar requests; the server resolves only currently eligible durable promotion and composition attestations under `run:create`, returning both dossier hashes. The browser validates the response identity, model, sidecar, date, and SHA-256 shapes before passing it to the worker. If requested advanced evidence is loading, blocked, incomplete, or malformed, App pauses analysis and displays the governance failure instead of silently producing an unadjusted run.

### 2.8 Run-backed portfolio comparison

Portfolio comparison now operates on immutable run projections rather than recomputing the authoritative decision from mutable UI state. It enforces:

- one selected run per issuer;
- completed status and eligible trust state;
- valid intrinsic range and ranking evidence;
- policy/schema compatibility;
- maximum point-in-time skew;
- duplicate issuer exclusion;
- uncertainty penalties;
- issuer and family allocation caps;
- policy-domain validation.

Fewer than two comparable issuers blocks the portfolio and forces every target weight to zero. Cap-constrained residual weight is explicitly disclosed as cash. The comparison report filters legacy rankings and charts to issuers admitted by the immutable-run trust decision, preventing excluded runs from bypassing the new panel.

Range eligibility is derived from the evidence-weighted synthesis defensibility and finite range itself, rather than requiring industrial scenario governance for unrelated financial-institution families.

### 2.9 Operations, backup, and health

Backup packages use SHA-256 payload hashes and an HMAC-SHA256 authenticator. Restore requires:

- valid authentication;
- safe object paths;
- exact manifest/payload bijection;
- expected media types and hashes;
- atomic restore-sink commit;
- restoration of verified manifest entries only.

Telemetry sanitizes payloads and cannot replace the business result or business exception if the telemetry sink fails.

Health checks validate configuration plus live operational evidence for:

- transactional metadata and object storage;
- authenticated sessions;
- distributed rate limits;
- authenticated backup scheduling;
- adapter read/write probes;
- current migration state;
- backup freshness;
- a verified isolated restore drill.

Activation now has an executable, fail-closed configuration contract (`2026-07-platform-activation-preflight-v1`) with separate runtime, operations, and release profiles. It validates PostgreSQL and HTTPS provider URLs, OIDC configuration, minimum 256-bit HMAC material, strong cron/health secrets, workspace health scope, outbox delivery, and bounded capacity overrides without returning secret values. The CLI can generate a non-overwriting local secret file with restrictive permissions and provider-owned blanks. Production runtime imports were also narrowed to server-safe modules so Node operations no longer transitively load the Vite-only Capitaline YAML mapping. The operator sequence is documented in `docs/production-platform-activation.md`.

CI includes the TCS acceptance path in the release dependency graph.

## 3. Principal files added or materially changed

- `src/platform/security/*`
- `src/platform/durablePersistence/*`
- `src/platform/operations/*`
- `src/platform/analysisPlatformService.ts`
- `src/platform/artifactRepository/*`
- `src/engine/scenarioCalibration/*`
- `src/engine/sectorCases/*`
- `src/engine/advancedModelGovernance/*`
- `src/engine/portfolioRunComparison.ts`
- `src/app/analysisRun/*`
- `src/components/RunBackedPortfolioComparison.tsx`
- `src/components/ComparisonReport.tsx`
- `server/routes/marketData.ts`
- `api/market-data/snapshot.js`
- `api/platform/health.js`
- `docs/generated/valuation-model-catalog.md`
- `.github/workflows/validate.yml`

## 4. Validation evidence

Validation was executed on 2026-07-13 in the repository workspace.

| Gate | Result |
|---|---|
| TypeScript `tsc --noEmit` | Passed |
| Any-type budget | Passed: 16 / 20 |
| Traceability schema pin | Passed: `2026-06-traceability-v20` |
| Model catalog freshness | Passed: 44 definitions |
| Audit snapshot transport integration | Passed |
| Focused production/governance suite | Passed; latest advanced-resolution/admission tranche: 49 tests across 11 files |
| Focused activation/platform suite | Passed: 19 tests across 9 files, including plain-Node runtime import |
| Full repository suite | All partitions passed: 244 test files passed, 1 skipped; 2,022 tests passed, 9 skipped |
| Company registry validation | Passed: 33 folders and ZIPs match |
| Vite production build | Passed: 1,471 modules transformed |
| Bundle budget | Passed: 73 JS chunks, 1,439.1 KB total gzip; all chunks within budget |
| Dependency audit | Passed: 0 known vulnerabilities after replacing SheetJS and pinning patched transitive releases |

The combined `npm run validate` process encountered the known intermittent Windows/esbuild access-denied error when Vitest started immediately after preceding gates. The audit integration passed independently. The first sharded run then exposed one stale catalog expectation after advanced models moved from `not-wired` to `partially-wired`; that test was corrected, its focused suite passed, and the complete unsharded repository suite passed. The later activation tranche was revalidated across every shard. Three-way contention caused the golden release test to exceed its 60-second per-test limit once; the same gate passed in isolation in 25 seconds, while the remaining interrupted shards passed sequentially. Build and bundle checks then passed. The launcher/access-denied and contention events are execution-environment handoff/performance faults, not unresolved assertion failures.

## 5. External activation prerequisites

The following items are deliberately not marked complete because they require deployment authority, secrets, managed infrastructure, market evidence, or independent human review. They must not be fabricated by repository code.

### 5.1 Provision and configure production providers

Provision PostgreSQL and private Vercel Blob, then configure `PLATFORM_DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, bounded pool settings, backup/outbox HMAC keys, cron authorization, and health scope. The repository now contains the concrete SQL repositories, Vercel object adapter, default runtime factory, migrations, and catch-all serverless handler.

### 5.2 Configure the identity tenant and client session bridge

Configure an HTTPS OIDC issuer, audience, signed organization claim, workspace memberships, and browser token acquisition. The server verifies RS256 discovery/JWKS signatures and derives organization identity only from signed claims. `App` accepts a `PlatformGovernanceConnection`; the selected identity provider must supply its access-token function and may supply reviewed advanced-sidecar requests for durable attestation resolution.

### 5.3 Historical calibration corpus

Ingest a reviewed, point-in-time scenario corpus with real `availableAt` evidence. The UI accepts calibration input and the run executor governs and persists it, but `AppShell` does not fabricate a corpus. Production forecasts therefore remain uncalibrated until this dataset is supplied.

### 5.4 Issuer sidecars and sector execution

Create, review, and approve issuer sidecars for applicable registry companies. Sector calculators, onboarding gates, durable sidecar storage, authenticated review, and AnalysisRun execution/artifact persistence are implemented, but no company is promoted to `ready` without reviewed evidence.

### 5.5 Advanced-model promotion evidence

Advanced models have governed AnalysisRun execution. R&D real options are now implementation-wired; ESG, FX, and lease models remain honestly `partially-wired` diagnostics. The real-options path has an explicit INR/INR-crore-to-per-share bridge, durable independently reviewed anti-double-counting dossiers, exact-base candidates, single-use synthesis substitution, and server-side durable admission. Promoted execution fails closed if the bridge is absent or invalid, and activation/admission fail closed on policy, project-set, authoritative target, base-result, lineage, date, materiality, ambiguity, duplicate application, forgery, workspace, or durable-review mismatches. Real issuer goldens, any required calibration evidence, and actual authenticated approvals remain external prerequisites before a production run can use this path. Other catalog entries that still say `not-wired` remain blocked.

### 5.6 Operational proof

Run `npm run platform:ops -- migrate` in staging, bootstrap the first administrator only on an empty workspace, exercise the live adapter probe, execute an authenticated backup, and perform the isolated restore drill. Daily backup, five-minute outbox, and monthly restore-drill handlers are scheduled in `vercel.json`. The health endpoint now performs live SQL/object I/O and remains blocked until migrations, backup freshness, and restore evidence are current.

## 6. Recommended activation sequence

1. Provision PostgreSQL, private Blob, OIDC, webhook receiver, and deployment secrets.
2. Run migrations, bootstrap the first workspace administrator, and execute the live probe in staging.
3. Configure the browser identity provider to supply `PlatformGovernanceConnection`, including advanced-sidecar requests where applicable.
4. Execute a signed backup and isolated restore drill until live health reports ready.
5. Ingest the historical calibration corpus and validate no-look-ahead reports.
6. Onboard reviewed sector sidecars, beginning with one utility, telecom, bank, NBFC, and insurance issuer.
7. Supply real-options issuer goldens and authenticated promotion/composition reviews; verify the already-wired substitution on staging goldens.
8. Run `npm run validate:release` plus the TCS browser acceptance test against staging.
9. Release behind a workspace-level feature flag, observe telemetry, then expand tenancy.

## 7. Final architecture assessment

The repository now has a coherent fail-closed platform architecture and a green implementation baseline. Analytical outputs are substantially more defensible because trust, time, evidence, model identity, and lifecycle are encoded in executable contracts.

The remaining production work is now sharply bounded: provision and configure external services, supply independently reviewed issuer evidence, and execute live operational proof. Provider adapters, atomic outbox behavior, verified-session enforcement, HTTP routes, scheduled operations, fail-closed health logic, the real-options unit/share bridge, durable anti-double-counting governance, exact-base synthesis substitution, server-side governance admission, and authenticated browser resolution are implemented rather than left as architectural placeholders.
