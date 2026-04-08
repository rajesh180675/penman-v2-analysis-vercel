# AFES Round Two — Master Operating Specification

Version: 2026-04-afes-v2  
Generated: 2026-04-08  
Status: Canonical draft for future AFES runs

---

## 1. Mission Statement

AFES (Autonomous Financial Engineering Swarm) is a controlled convergence loop.

Its purpose is to reach provable correctness in:

1. Financial model integrity (Penman-Nissim faithful)
2. Data mapping fidelity (Capitaline labels → engine inputs)
3. Code correctness (TypeScript, tests, Vercel deployment)
4. Trust surface honesty (UI does not overstate rigor)
5. Production security (fail-closed, auth-gated, observable)
6. Academic defensibility (outputs usable by serious analysts)

AFES terminates only when all of these are simultaneously true on current-tree evidence, not stale reruns or assumptions.

---

## 2. What Was Missing From the Original Template

This round-two spec explicitly fixes the gaps discovered in the earlier AFES design:

- only 6 agents — too few for this system
- no dedicated financial-institution path auditor
- no Capitaline schema evolution / label drift auditor
- no performance / memory / Vercel-limits auditor
- no cross-period identity / lineage auditor
- no India regime specialist
- no dedicated security/auth auditor
- no test coverage quality auditor
- no API contract stability auditor
- no UI accessibility / trust-surface auditor
- no explicit pre-flight phase
- no re-entry protocol for partially completed rounds
- no graded consensus scoring
- no conflict-resolution rules
- debate started too early instead of waiting for enough evidence

---

## 3. Mandatory Pre-Flight Checklist

Do not launch any agents until all pre-flight checks pass.

### PF-001 Blackboard API Health
- `GET /api/blackboard?session=preflight` returns 200 and valid JSON
- `POST /api/blackboard` returns 200 with `mode: blob+local` or `mode: local-only`
- If POST fails: stop and fix blackboard before agent launch

### PF-002 TypeScript Baseline
- `npx tsc --noEmit`
- Must return zero errors

### PF-003 Test Suite Baseline
- `npm test`
- Must pass fully; record the exact count

### PF-004 Environment Variables Present
Required:
- `BLOB_READ_WRITE_TOKEN`
- `AUDIT_ADMIN_TOKEN`

### PF-005 Git Working Tree Clean
- `git status --porcelain`
- Must be empty before launch

### PF-006 Blackboard Schema Match
- Confirm blackboard schema version is current and readable

### PF-007 Deployment Readiness Visibility
- If Vercel CLI/runtime status is available, record it
- Otherwise mark deployment status as `unverified`

### PF-008 YAML Audit Data Available
- Confirm the Capitaline/YAML audit source path used for deep label audits

### Pre-Flight Result Shape

```json
{
  "preflight": {
    "timestamp": "2026-04-08T00:00:00Z",
    "PF-001_blackboard_get": "pass|fail",
    "PF-001_blackboard_post": "pass|fail",
    "PF-001_persistence_mode": "blob+local|local-only|failed",
    "PF-002_typescript": "pass|fail",
    "PF-003_tests": "pass|fail",
    "PF-003_test_count": 228,
    "PF-004_env_vars": "pass|fail",
    "PF-005_git_clean": "pass|fail",
    "PF-006_schema_version": "2026-04-afes-blackboard-v1",
    "PF-007_vercel_deployment": "green|unverified|red",
    "PF-008_yaml_path": "./audit-run.yaml",
    "go_nogo": "GO|NO-GO"
  }
}
```

Proceed only if `go_nogo = GO`.

---

## 4. Agent Topology

Round Two uses **12 Wave-1 agents** plus **3 Wave-2 synthesis agents**.

### Wave 1 — Evidence Collection (Parallel)
All run simultaneously. They do not debate each other. They return structured JSON to the orchestrator.

#### Agent 01 — Data Architect / Capitaline Mapping Auditor
Scope:
- mapping audit
- mapping cluster engine
- parser completeness
- alias registries
- YAML label cross-reference

Must test:
- every YAML label → parser recognition and correct canonical field
- unit handling
- novel label variants
- tier enforcement
- minority-interest flow
- share-count variants

#### Agent 02 — Penman-Nissim Mathematical Integrity Auditor
Scope:
- `PenmanNissimEngine.ts`
- `valuationCommandCenter.ts`
- `valuationPolicy.ts`
- `earningsQuality.ts`
- valuation tests

Must verify:
- clean-surplus relation
- ReOI identity
- FCFF identity
- equity bridge
- reverse-DCF per-share consistency
- negative equity handling
- FI separation
- DD / REM methodology
- WACC sourcing
- numerical spot checks against known fixtures

#### Agent 03 — React / Vercel Deployment Engineer
Scope:
- `vercel.json`
- API routes
- React components
- bundle/build/runtime
- env variable handling

Must test:
- build success
- serverless size/timeout risk
- client/server boundary safety
- error-boundary coverage
- bundle size and major chunk risk

#### Agent 04 — Finance Researcher / Framework Completeness
Scope:
- institutional-grade vs heuristic distinction
- valuation rigor
- governance overlay completeness
- language overstatement audit
- India-specific methodological adequacy

#### Agent 05 — Devil’s Advocate / Adversarial Stress Tester
Scope:
- malformed input
- pathological financial cases
- API auth and payload behavior
- UI trust failures
- stale-state corruption
- production simulation

#### Agent 06 — Cross-Period Identity & Data Lineage Auditor
Scope:
- raw input → engine output lineage
- period ordering
- delta correctness
- missing period handling
- restatement handling
- unit consistency

#### Agent 07 — Test Coverage Quality Auditor
Scope:
- whether tests are deep enough
- regression coverage
- edge-case coverage
- integration gaps
- flaky tests
- data realism in tests

#### Agent 08 — API Contract Stability Auditor
Scope:
- `/api/blackboard`
- `/api/research`
- route schemas
- idempotency
- auth consistency
- rate limits
- payload limits

#### Agent 09 — India Market Regime Specialist
Scope:
- RPT intensity
- promoter pledge
- Ind AS vs IGAAP handling
- India WACC components
- conglomerate handling
- quarterly annualization

#### Agent 10 — Performance & Scalability Auditor
Scope:
- engine complexity
- memory usage
- large dataset processing
- React render load
- bundle size
- API response times

#### Agent 11 — Security & Auth Posture Auditor
Scope:
- auth enforcement
- secrets exposure
- bundle leakage
- dependency vulnerabilities
- CORS
- input validation
- rate limiting

#### Agent 12 — Financial Institution Path Specialist
Scope:
- FI detection logic
- fallback UI
- FI metric availability
- FI valuation framework completeness

### Wave 2 — Synthesis Layer (Sequential)
These agents read Wave-1 findings from the blackboard.

#### Wave2-A — Cross-Agent Synthesis & Conflict Resolver
Rules:
- if two agents disagree on severity, escalate to higher severity
- if 3+ agents mention an issue, treat it as systemic
- if Devil’s Advocate disproves optimism, Devil’s Advocate wins
- output one merged issue list ordered by:
  1. security/safety
  2. mathematical correctness
  3. data correctness
  4. code correctness
  5. completeness
  6. performance

#### Wave2-B — Implementation Planner
Outputs:
- exact files to change
- exact tests to add
- change sequencing
- dependency ordering
- risk by fix batch

#### Wave2-C — Consensus Evaluator / Loop Master
Answers four questions:
1. Did Devil’s Advocate find blocking flaws?
2. Does build/deploy work?
3. Does Penman-Nissim integrity hold?
4. Is blackboard persistence reliable?

Scoring:

```text
consensus_score = (passing_questions / 4) * (1 - critical_count * 0.25)
```

Terminate only if:
- `consensus_score >= 0.9`
- `critical_count == 0`

Then normalize termination to `consensus_score = 1.0`.

---

## 5. Blackboard Schema v2

```json
{
  "schemaVersion": "2026-04-afes-blackboard-v2",
  "session": "2026-04-08-round2",
  "round": 2,
  "wave": 1,
  "agents_expected": 12,
  "agents_completed": 0,
  "agents_pending": 12,
  "consensus_score": 0.0,
  "last_updated": null,
  "preflight": {
    "passed": false,
    "timestamp": null,
    "go_nogo": "NO-GO"
  },
  "environment": {
    "platform": "firebase-cloud-terminal",
    "deployment": "vercel",
    "stack": "react",
    "data_source": "capitaline",
    "node_version": "v20.18.1",
    "vercel_cli": "50.41.0"
  },
  "baseline": {
    "typescript_check": "passed",
    "test_suite": "228/228",
    "test_count": 228,
    "last_commit": "ea2f9ac",
    "deployment_status": "unverified"
  },
  "wave1_findings": {},
  "wave2_synthesis": {},
  "debate_log": [],
  "fix_batches": [],
  "consensus_questions": {
    "Q1_devils_advocate_clear": null,
    "Q2_build_deploy_green": null,
    "Q3_penman_nissim_integrity": null,
    "Q4_blackboard_reliable": null
  },
  "round_complete": false
}
```

---

## 6. Round-Robin Routing Protocol

### Phase 1 — Evidence
- launch all 12 Wave-1 agents in parallel
- subagents are read-only from an authority perspective
- each returns JSON to orchestrator
- orchestrator writes findings to blackboard
- Wave 2 begins only after all required evidence exists

### Phase 2 — Synthesis
- conflict resolver
- implementation planner
- consensus evaluator

### Phase 3 — Fix / Validate / Rerun
If consensus is not high enough:
- implement fixes
- rerun validation
- rerun targeted critics
- return to synthesis

---

## 7. Exit Criteria (Strict)

### Mandatory
- Devil’s Advocate finds zero critical/high blockers
- TypeScript zero errors
- tests all passing
- build clean
- blackboard POST confirmed working
- all required Wave-1 findings returned
- Wave-2 synthesis complete
- `consensus_score == 1.0`
- current-tree rerun confirms no regressions

### Required for Financial Correctness
- clean-surplus relation verified numerically
- ReOI identity verified with opening NOA/NFO logic
- FCFF identity consistent across engine and command center
- negative equity preserved
- reverse-DCF compares per-share to per-share
- financial institutions correctly separated from industrial path

### Required for Data Integrity
- YAML audit labels handled or explicitly deferred
- period ordering consistent
- unit consistency verified
- novel labels surfaced instead of silently dropped

### Required for Production
- no secrets in code/client bundle
- auth-required routes fail closed
- no unaddressed high/critical dependency vulnerabilities
- deployment posture judged safe

---

## 8. Lessons Incorporated From Round One

- subagents can fail to write files -> orchestrator-write model is mandatory
- blackboard cannot rely only on local file writes -> API-backed blackboard is required
- debate must wait for evidence -> no premature round-robin
- negative-equity masking is a trust-critical issue -> math foundations first
- deployment/auth defaults matter -> fail closed in production
- stale worktrees can mislead closure decisions -> closure must use current-tree evidence
- safe suggestion exposure is better than unsafe auto-remapping -> cluster engine first appears in audit/reporting path
- observability matters -> silent sync failures are not acceptable
- current-tree reruns are required before termination

---

## 9. Session Report Update Protocol

After each fix batch:

1. run validation
2. update blackboard
3. append session report
4. commit and push if requested for that round

---

## 10. Future Round Types

### Round Type A — Stabilization
Use when trust/security/math/data integrity is broken.

### Round Type B — Architectural Expansion
Use once stable to add:
- live cluster-engine mapping contracts
- deeper forensic overlays
- sector-specific valuation frameworks

### Round Type C — Closure Verification
Use after many fixes to rerun on current tree only.

### Round Type D — Production Hardening
Use before public launch:
- load testing
- penetration testing
- accessibility
- disaster recovery
- SLA/runtime confidence

---

## 11. Canonical AFES Round-Two Prompt

```text
You are AFES Round Two Orchestrator for the Penman-Nissim Financial Analysis tool (React + Vercel + Capitaline data).

MISSION:
Audit, debate, fix, and validate this codebase to production-grade financial analysis correctness using a 12-agent, 2-wave autonomous loop.

MANDATORY PRE-FLIGHT:
1. Verify POST /api/blackboard returns 200
2. Verify TypeScript passes
3. Verify all tests pass
4. Verify git working tree is clean
5. Verify BLOB_READ_WRITE_TOKEN and AUDIT_ADMIN_TOKEN are in env
6. Locate the YAML audit file path
7. Write pre-flight results to blackboard
8. Proceed only if all pass

WAVE 1:
Launch the 12 specialist auditors in parallel.
They return structured JSON only.
Orchestrator writes blackboard.
Do not begin Wave 2 until the evidence threshold is met.

WAVE 2:
- conflict resolution
- implementation plan
- consensus evaluation

RULES:
1. Blackboard is the coordination primitive
2. Subagents return JSON; orchestrator writes shared state
3. Devil’s Advocate overrides optimistic assessments on trust/safety
4. Fix security and math before features
5. Exit only on current-tree evidence
6. Never auto-mutate canonical mappings from cluster suggestions
7. Fail closed on production trust paths

EXIT CONDITION:
consensus_score == 1.0 requires:
- no critical blockers
- typecheck clean
- tests clean
- build clean
- blackboard POST confirmed
- Penman-Nissim identities verified enough for this round
- Devil’s Advocate finds nothing blocking
```

---

## 12. Launch Notes

Suggested launch sequence:

1. save this spec in the repo
2. run pre-flight
3. initialize blackboard for the round
4. launch Wave 1 in parallel
5. merge findings
6. run Wave 2 synthesis
7. implement/fix/rerun until consensus terminates

This document is intended to be reused as the Round Two AFES launch blueprint for future sessions.
