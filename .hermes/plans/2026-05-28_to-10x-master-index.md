# Master Index — Path to 10/10 (10 plans, ~40 PRs)

> **For Hermes:** Orchestration sheet for the complete roadmap. Implement against individual plan files, not this index.

## Why ten plans, not six

The original six plans (1-6) close the *technical-debt* and *modelling-fidelity* gaps. They top out at ~9.3/10 because they don't touch reviewer experience, accessibility, internationalization, production observability, or institutional-grade modelling depth.

Plans 5b, 7, 8, 9 close those remaining gaps. Together with 1-6, they form the complete 10/10 roadmap.

## The ten plans

| Plan | Title | PRs | Schema bumps | Dependencies | Headline outcome |
|---|---|---|---|---|---|
| 1 | Type Safety Hardening | 4 | v12→v13 | — | Branded primitives, strict tsconfig, 196→<30 `any` |
| 2 | Decompose God Modules | 3 | none | — | No file >600 lines |
| 3 | Pipeline Strategy Refactor | 5 | v13→v14 | Plan 1 | Single interface for industrial/bank/NBFC/insurance |
| 4 | Multi-Tenant Persistence | 4 | none | — | Vercel KV canonical, cross-device |
| 5 | Financial-Modelling Depth | 5 | v14→v15 | Plan 3 | Reverse-DCF intervals, clean-surplus, CAPM Damodaran, SOTP, Ind-AS 116 |
| 5b | Modelling Depth Advanced | 5 | v15→v16 | Plan 5 | Real-options, credit-spread WACC, working-capital, ESG, FX hedging |
| 6 | Security & Operations | 4 | none | — | CSP, fuzz, bundle split, migration runner |
| 7 | A11y, i18n, Mobile | 4 | none | — | WCAG 2.2 AA, 4 languages, responsive, print |
| 8 | Reviewer Experience | 3 | v16→v17 | Plan 4 | Annotation, run-diff, evidence locking, reproducibility hash |
| 9 | Production Observability | 4 | none | Plan 4 | Sentry+OTel, immutable event log, DR, load testing |

**Total:** ~40 PRs across 5 schema bumps (v12 → v17).

## Recommended landing order — 8 weeks

```
Week 1 — Foundation
  Plan 1 PR-1.1   (split types.ts)
  Plan 1 PR-1.2   (strip any to <30)
  Plan 1 PR-1.3   (strict tsconfig)
  Plan 6 PR-6.1   (CSP + sanitize)
  Plan 6 PR-6.4   (migration runner)

Week 2 — Type discipline + decompose
  Plan 1 PR-1.4   (branded primitives, schema v13)  ← serial
  Plan 2 PR-2.1   (decompose App.tsx)
  Plan 2 PR-2.2   (decompose v3Analytics)
  Plan 2 PR-2.3   (decompose god-components)
  Plan 4 PR-4.1   (KV foundation, identity)         ← serial dep for Plan 4

Week 3 — Pipeline strategy
  Plan 3 PR-3.1   (interface, schema v14)           ← serial
  Plan 3 PR-3.2   (industrial canary)
  Plan 3 PR-3.3   (bank)
  Plan 3 PR-3.4   (NBFC + insurance)
  Plan 3 PR-3.5   (cleanup, delete duplicates)

Week 4 — Persistence + ops
  Plan 4 PR-4.2   (audit runs in KV)
  Plan 4 PR-4.3   (comparison registry in KV)
  Plan 4 PR-4.4   (residuals cross-device)
  Plan 6 PR-6.2   (parser fuzz)
  Plan 6 PR-6.3   (bundle split)
  Plan 9 PR-9.1   (Sentry + OTel)

Week 5 — Modelling depth (foundational)
  Plan 5 PR-5.1   (reverse-DCF intervals)
  Plan 5 PR-5.2   (clean-surplus)
  Plan 5 PR-5.3   (CAPM Damodaran)
  Plan 5 PR-5.4   (SOTP, schema v15)
  Plan 5 PR-5.5   (Ind-AS 116 leases)

Week 6 — Modelling depth (advanced) + observability
  Plan 5b PR-5b.1 (real-options)
  Plan 5b PR-5b.2 (credit-spread WACC)
  Plan 5b PR-5b.3 (working-capital)
  Plan 5b PR-5b.4 (ESG-adjusted ke)
  Plan 5b PR-5b.5 (FX hedging, schema v16)
  Plan 9 PR-9.2   (event log)

Week 7 — Reviewer experience + a11y
  Plan 8 PR-8.1   (annotations)
  Plan 8 PR-8.2   (run-diff)
  Plan 8 PR-8.3   (evidence locking, schema v17)
  Plan 7 PR-7.1   (a11y foundation)
  Plan 7 PR-7.2   (i18n: en/hi/ta/bn)

Week 8 — Polish + DR
  Plan 7 PR-7.3   (responsive)
  Plan 7 PR-7.4   (print stylesheets)
  Plan 9 PR-9.3   (DR + backups)
  Plan 9 PR-9.4   (load testing)
```

## Schema-version timeline

| Schema | Plan | When |
|---|---|---|
| v12 | Plan v4 PR-D | shipped |
| v13 | Plan 1 PR-1.4 | week 2 |
| v14 | Plan 3 PR-3.1 | week 3 |
| v15 | Plan 5 PR-5.4 | week 5 |
| v16 | Plan 5b PR-5b.5 | week 6 |
| v17 | Plan 8 PR-8.3 | week 7 |

Each bump increments the migration-runner registry (Plan 6 PR-6.4 is the framework; subsequent bumps add migrators).

## Cumulative acceptance — 10/10

After all ~40 PRs land:

```bash
# ─── Schema timeline complete ─────
grep TRACEABILITY_SCHEMA_VERSION src/engine/policyVersions.ts   # = "2026-06-traceability-v17"

# ─── Type quality ──────────────────
grep -rn "\bany\b" src/engine/ | grep -v "^//\|test\|spec" | wc -l   # ≤ 30
grep -rn "INRCrore\|CroreShares\|PercentFraction" src/engine/ | wc -l # ≥ 200

# ─── File-size discipline ─────────
find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn | head -10
# Top 10 all ≤ 600 lines

# ─── Pipeline sector provenance ──────────
# (ADR-006 superseded 2026-05-30: the strategy spine was a premature abstraction
#  over a 2-way dispatch fork. Gate asserts the OUTCOME — every run stamps its
#  audited sector path — not the MECHANISM. See docs/adr/006.)
grep -n "pipelineStrategyId" src/engine/analysisTraceability.ts  # stamp resolved from the dispatch fork
ls src/engine/__tests__/pipelineStrategyStamp.spec.ts            # provenance regression test present

# ─── Persistence ──────────────────
grep -rn "kvGet\|kvSet" src/lib/ | wc -l   # ≥ 20

# ─── Modelling depth ──────────────
grep -rn "analyticalDepth\." src/engine/ | wc -l   # ≥ 10 (5 from Plan 5 + 5 from 5b)

# ─── Security ─────────────────────
curl -I $PROD_URL | grep -i "Content-Security-Policy"   # present
npm run test:fuzz   # 50 cases pass

# ─── Reviewer experience ──────────
grep -rn "AnnotatableCell\|envelopeHash\|lockState" src/   # ≥ 6

# ─── Accessibility ────────────────
npm run test:e2e -- --grep "@a11y"   # 0 critical violations
node scripts/check-i18n-completeness.cjs   # exit 0

# ─── Observability ────────────────
grep -rn "Sentry\|captureWithContext" src/   # ≥ 5
ls vercel-blob://kv-backup/   # daily backups
node scripts/verify-event-chain.cjs   # exit 0

# ─── Suite green ──────────────────
npm run validate:release
```

## What 10/10 means qualitatively

A skeptical CFA + senior architect + accessibility consultant + ops engineer all open the codebase together and find:

**Software architecture**
- No file too long to read; primitives carry unit semantics; every run stamps its audited sector path
- Multi-tenant with offline support; CSP, sanitization, fuzz tests; envelope schemas upgrade in place

**Domain rigor (Plans 5 + 5b)**
- Reverse DCF outputs intervals + sensitivity
- Clean-surplus residual tracked as single auditable percentage
- CAPM `ke` cites Damodaran year+sector
- WACC uses credit-spread-aware market `kd`
- Conglomerates SOTP-valued
- Asset-heavy companies flag Ind-AS 116 inconsistencies
- Pipeline-heavy companies (pharma) carry real-options enterprise value
- Working-capital sustainability is a first-class gate
- ESG-adjusted `ke` with sourced score
- FX-exposed companies show reported vs FX-neutral revenue

**Reviewer experience (Plan 8)**
- Cell-level annotations with multi-user threads
- Run-diff between any two runs of the same company, ranked by impact
- Evidence locking with sign-off; immutable after sign-off
- Reproducibility hash proves engine determinism
- Excel exports carry annotations + lock state

**Accessibility & reach (Plan 7)**
- WCAG 2.2 AA conformant; verified by axe + manual screen reader
- 4 languages with reviewer-grade financial translation
- Mobile-tested at 3 breakpoints
- Print-ready PDFs

**Operational maturity (Plan 9)**
- Sentry + OpenTelemetry capturing every error with run/company/user context
- Immutable hash-chained event log archived daily
- Automated daily backups, quarterly restore drill
- Performance baselines published; load-tested for 1K concurrent users

**Test discipline (preserved + extended)**
- Rigor ladder gates fail closed
- Mutation testing (PR-9.x optional follow-up)
- Visual regression locked
- Property-based tests for unit-contract invariants

## Risk consolidation

The single largest aggregate risk is **interface drift**: 5 schema bumps + ~40 PRs touching the envelope means hundreds of synchronization points. Mitigation:

1. Each schema bump's PR ships migration in same PR (registry framework from Plan 6 PR-6.4).
2. `companyRegistryStore.spec.ts` schemaVersion fixture is the single chokepoint; CI catches drift.
3. Workbook regression contract pins auditor-facing surface; CI catches drift there too.
4. Operational handoff doc updated after each plan completes.
5. Reproducibility hash (Plan 8 PR-8.3) detects any non-determinism introduced by plan execution itself.

## Realistic ceiling

Even with all ~40 PRs landed, the realistic score is **9.7/10**, not 10.0. The asymptote at 10/10 is unreachable because:
- Domain reviewer subjectivity will always find one more lens to add
- Regulatory landscape evolves (new SEBI circulars, new Ind-AS revisions)
- Performance baselines drift as user behavior changes
- Translation quality is a continuous calibration problem

10/10 is a moving target. 9.7 is the stable equilibrium where new work is feature work on a sound foundation, not architectural debt repair.

## When to stop

After all plans land:
- ~40 PRs merged green
- Schema at v17
- `validate:release` + `test:fuzz` + `test:e2e` all pass
- Operational handoff documents per plan complete
- No "this should not exist" finding from a blind code review by domain + architecture + a11y reviewer

If any condition fails after week 8, write **Plan 10** addressing the specific delta. Do not extend existing plans.
