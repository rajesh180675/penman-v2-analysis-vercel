# To-10x Sweep Closure

This directory holds the original implementation plans authored at the start of the to-10x sweep, preserved for posterity. Each plan ships exactly the PRs it specified — no scope creep, no drops.

## Outcome

41 PRs merged across 10 plans (#149 → #189), zero rollbacks, zero force-pushes.

| Plan | PRs | Schema bump | Status |
|------|-----|-------------|--------|
| 1 — Type Safety | 4 (#149-152) | v12 → v13 | ✓ done |
| 2 — Decompose God-Modules | 3 (#153-155) | none | ✓ done |
| 3 — Pipeline Strategy | 5 (#156-160) | v13 → v14 | ✓ done |
| 4 — Multi-Tenant Persistence | 4 (#161-164) | none | ✓ done |
| 5 — Modelling Depth | 5 (#165-169) | v14 → v15 | ✓ done |
| 5b — Modelling Advanced | 5 (#170-174) | v15 → v16 | ✓ done |
| 6 — Security & Ops | 4 (#175-178) | none | ✓ done |
| 7 — A11y / i18n / Mobile | 4 (#179-182) | none | ✓ done |
| 8 — Reviewer Experience | 3 (#183-185) | v16 → v17 | ✓ done |
| 9 — Production Observability | 4 (#186-189) | none | ✓ done |

## Release-grade verification (post-sweep)

Run on `ops/sweep-closure` after all merges:

```
npm run validate:release
- typecheck       — 0 errors
- lint:any        — clean
- test:golden     — pass
- test            — 1469 passed | 9 skipped (cyclical advanced models)
- build           — built in 1m 42s
- lint:bundle     — 71 JS chunks, total gz 1190 KB; all within budget
```

Top 5 chunks gzipped: vendor-file-parsing 292.5 KB, index 110.9 KB, vendor-jspdf 108.1 KB, vendor-charts 93.6 KB, vendor-katex 74.9 KB.

## What's NOT in scope of these plans

The plans capture deliberate carve-outs you might mistake for omissions:

1. `noUncheckedIndexedAccess` (1522 errors) and `exactOptionalPropertyTypes` (84 errors) — costed in Plan 1 PR-1.3 and explicitly deferred. Each is a multi-week effort with low marginal reviewer-trust gain.
2. UI surface integration for the new logic (cell annotations, run-diff, evidence locking, observability) — pure logic ships under Plan 8/9 with full tests; per-tab UI adoption is feature work, not architecture.
3. Vercel Cron worker for backups — Plan 9 PR-9.3 ships the pure scheduler; the cron-triggered worker that calls it is mechanical follow-up.
4. Sentry SDK wire-up — Plan 9 PR-9.1 ships the shim with PII scrubber as NOOP-when-DSN-absent; SDK init is a 5-line follow-up once DSN is provisioned.
5. Strict valuation glossary translation in hi/ta/bn — Plan 7 PR-7.2 ships en/hi/ta/bn for nav + common labels; valuation glossary stays English until a finance-domain translator signs off.

## Realistic ceiling

The master index called out 9.7/10 as the realistic ceiling. The plans hit it. Beyond this point, additional work is feature work on a sound foundation, not architectural debt repair.
