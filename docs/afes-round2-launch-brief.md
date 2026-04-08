# AFES Round Two — Launch Brief
## Based on VST Production Run Evidence

Version: 2026-04-afes-round2-launch  
Generated: 2026-04-08  
Status: Ready to launch after pre-flight

---

## Context For The Model

You are being handed a live production run result.
VST Industries (`VST.NSE`) was analysed through the Penman-Nissim engine. The output is real. The issues below are real. Your job is to fix them.

Do not treat this as a theoretical exercise.
Every issue below has evidence from the actual app output.
Every fix must be verified against the actual codebase.
Every validation must run against the actual test suite.

### Current baseline
- Tests passing: **228/228**
- TypeScript: clean
- Recommended baseline commit for launch: **current `main`**
- Last known startup-fix commit: `38254ab`
- Blackboard: `.afes-blackboard.json` (operational)
- Session report: `docs/session-progress-report-2026-04-08.md`

Important: closure must rely on **current-tree evidence only**. Stale worktree findings are not authoritative unless revalidated against the current tree.

---

## Part 1: Mandatory Pre-Flight

Complete all eight checks before spawning any agent.
Write results to the blackboard. Proceed only if `go_nogo` is `GO`.

### PF-001: Blackboard API Health

```bash
node --input-type=module -e "
import handler from './api/blackboard/index.js';
const req = {
  method: 'POST',
  query: {},
  headers: { 'x-audit-token': process.env.AUDIT_ADMIN_TOKEN },
  body: {
    session: 'round2-preflight',
    operation: 'patch-session-metadata',
    round: 2
  },
  socket: { remoteAddress: '127.0.0.1' }
};
const res = {
  statusCode: 200,
  headers: {},
  status(c) { this.statusCode = c; return this; },
  json(b) {
    console.log('PF-001:', JSON.stringify(b));
    return this;
  },
  setHeader(k, v) { this.headers[k] = v; }
};
await handler(req, res);
"
```

Expected:
- `ok: true`
- mode is one of:
  - `blob+local`
  - `blob`
  - `local-only` (dev/local only)

If POST fails: stop and fix blackboard before agent launch.

### PF-002: TypeScript Baseline

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Must return zero errors.

### PF-003: Test Suite Baseline

```bash
npm test -- --passWithNoTests 2>&1 | tail -10
```

Must show **228/228** passing. Record exact count.
This is the floor. No fix batch may reduce this count.

### PF-004: Environment Variables

```bash
node -e "
const required = ['BLOB_READ_WRITE_TOKEN', 'AUDIT_ADMIN_TOKEN'];
const missing = required.filter(k => !process.env[k]);
console.log(missing.length === 0
  ? 'PF-004: pass'
  : 'PF-004: FAIL missing: ' + missing.join(', '));
"
```

### PF-005: Git Working Tree Clean

```bash
git status --porcelain
```

Must be empty. Commit or stash before launch.

### PF-006: Blackboard Schema Version

```bash
node -e "
const bb = JSON.parse(
  require('fs').readFileSync('.afes-blackboard.json', 'utf8')
);
console.log('schema:', bb.schemaVersion);
console.log('last round:', bb.round);
console.log('agents completed:', bb.agents_completed);
"
```

### PF-007: YAML Audit File Location

```bash
find . -name "*.yaml" -not -path "*/node_modules/*" | head -10
find . -name "audit-run*.yaml" -not -path "*/node_modules/*"
```

Record exact path. Required by agents 01, 02, 06, 09.

### PF-008: Vercel Deployment Status

```bash
vercel ls 2>/dev/null | head -5 || echo "vercel not linked"
npm run build 2>&1 | tail -10
```

Record build status. Flag build errors as blocking.

### Pre-Flight Result Shape

```json
{
  "preflight": {
    "timestamp": "2026-04-08T00:00:00Z",
    "PF-001_blackboard_post": "pass|fail",
    "PF-001_persistence_mode": "blob+local|blob|local-only|failed",
    "PF-002_typescript": "pass|fail",
    "PF-002_error_count": 0,
    "PF-003_tests": "pass|fail",
    "PF-003_test_count": 228,
    "PF-004_env_vars": "pass|fail",
    "PF-005_git_clean": "pass|fail",
    "PF-006_schema_match": "pass|fail",
    "PF-007_yaml_path": "./CapitalineIndASDetailedMappingSpec.yaml",
    "PF-008_build": "pass|fail",
    "blocking_failures": [],
    "go_nogo": "GO|NO-GO"
  }
}
```

Proceed only if `go_nogo = GO`.

---

## Part 2: Evidence Base From Production Run

Every agent must read this section before writing findings.
This is not hypothetical. This is what the live app produced.

### E-001: Reconciliation Residual 193.14% (CRITICAL)

Observed in app output:

```text
Reconciliation: FAILED
max residual 193.14%
Worst check: Δ Cash and Bank = CFO - Capex - Distributions
             + Equity/Financing/Investment Flows
             in 2022-03-31 at 193.14%
36 reconciliation residual checks breached critical threshold
```

VST runs a very large liquid investment portfolio.
The reconciliation identity should correctly net investment portfolio churn against financial asset movements rather than treating it as unexplained cash leakage.

### E-002: RE vs ReOI Gap 16.4% (HIGH)

Observed in app output:

```text
RE-ReOI gap: 16.4% (CRITICAL flag in V3 analytics)
Gap decomposition:
  Dirty surplus PV:      +28 Cr
  NFO timing:           -289 Cr
  TV divergence:        +232 Cr
  Explicit-period disc: +120 Cr
  Residual:              +51 Cr
Primary driver: nfo_timing
```

Under consistent Penman-Nissim assumptions, RE and ReOI should converge within a tight tolerance.

### E-003: A9 Identity Failures 9 of 10 Periods (MEDIUM)

Observed in app output:

```text
A9: Pass 1 / Fail 9
```

The issue is not merely failing A9, but categorizing why the failure occurred:
- `ind-as-transition`
- `structural-event`
- `large-dirty-surplus`
- `unexplained`

Only `unexplained` should remain materially concerning.

### E-004: Incremental ROIC Floor Not Disclosed (MEDIUM)

Observed output showed `-10.0%` repeatedly as if computed, when it was really a guarded/floored display value driven by near-zero `ΔNOA` instability.

### E-005: Shared Sync 401 UX Gap (LOW)

Observed UX:

```text
Shared comparison sync: Request failed: 401
```

This should become contextual and user-friendly, not raw transport noise.

### E-006: Mapping Backlog 131 Actionable Items (MEDIUM)

Observed backlog includes material unmapped items such as:
- Less: Excise Duty
- Investments in Mutual Funds
- Total PPE (not under Lease)
- Profit Before Extraordinary
- Cash Flow before Extraordinary

Top YAML/data label drift must be resolved.

### E-007: ΔOther OA Residual-Heavy (LOW/MEDIUM)

Observed periods with large `ΔOther OA / ΔOA` ratios suggest missing OA sub-components or poor decomposition visibility.

### E-008: PM Warning Threshold Inconsistency (LOW)

Observed in memo/trust language. Must be verified against registry/policy definitions.

---

## Part 3: Wave 1 Agent Missions (12 Agents, Parallel)

All 12 launch simultaneously.
No agent reads another’s findings in Wave 1.
All return structured JSON to the orchestrator.
The orchestrator writes findings to the blackboard.

### Universal Return Schema

```json
{
  "agentId": "string",
  "round": 2,
  "wave": 1,
  "timestamp": "ISO8601",
  "evidence_items_reviewed": ["E-001", "E-002"],
  "findings": {
    "critical": [],
    "high": [],
    "medium": [],
    "low": [],
    "summary": {
      "total_issues": 0,
      "critical_count": 0,
      "high_count": 0,
      "medium_count": 0,
      "low_count": 0,
      "tests_run": 0,
      "tests_passed": 0,
      "coverage_notes": "string"
    }
  }
}
```

### Agent Set

1. `data-architect`
2. `penman-nissim-theorist`
3. `react-vercel-engineer`
4. `finance-researcher`
5. `devils-advocate`
6. `lineage-auditor`
7. `test-coverage-auditor`
8. `api-contract-auditor`
9. `india-regime-specialist`
10. `performance-auditor`
11. `security-auditor`
12. `fi-specialist`

Each agent should focus on the evidence items and specialties defined in your expanded blueprint.

---

## Part 4: Wave 2 Synthesis Agents

Launch only after all 12 Wave 1 agent findings are persisted.

### WAVE2-A: Cross-Agent Synthesis and Conflict Resolver
Rules:
- if two agents disagree on severity, use the higher severity
- if 3 or more agents independently report the same issue, mark it systemic
- Devil’s Advocate overrides optimistic trust/safety claims
- stale-worktree conclusions do not close issues without current-tree verification

### WAVE2-B: Implementation Planner
Expected fix batches for this round:
1. Mathematical alignment (RE-ReOI gap)
2. Reconciliation formula for investment-heavy firms
3. A9 categorization
4. Incremental ROIC disclosure
5. Shared-sync UX and threshold consistency
6. Mapping backlog triage and YAML drift

### WAVE2-C: Consensus Evaluator
Questions:
1. Did Devil’s Advocate find blocking flaws?
2. Does build/deploy work?
3. Does Penman-Nissim integrity hold?
4. Is blackboard persistence reliable?

Score:

```text
consensus_score = (passing_questions / 4) * max(0.0, 1.0 - critical_count * 0.25)
```

Terminate only if:
- `consensus_score >= 0.9`
- `critical_count == 0`
- current-tree reruns confirm no regressions

---

## Part 5: Fix Batch Protocol

For every fix batch:

1. read the batch plan
2. implement only that batch
3. add regression tests
4. run `npx tsc --noEmit`
5. run `npm test`
6. run `npm run build` if routing/deployment paths changed
7. append a fix batch record to the blackboard
8. append a fix batch note to the session report
9. commit the batch
10. rerun targeted critics if required

Do not reduce the test count below the baseline.

---

## Part 6: Exit Criteria

The round terminates only when all of the following are true on current-tree evidence.

### Mathematical Exit Criteria
- RE-ReOI gap below 5%
- NFO timing aligned in explicit and terminal periods
- A9 failures categorized by reason code
- unexplained A9 failures reduced to zero
- Incremental ROIC floor disclosed as guarded, not computed
- reconciliation residual below 10% for VST
- cash flow reconciliation validated for investment-heavy firms
- negative equity preserved (no zero clamp)
- reverse-DCF per-share comparison correct

### Code / Process Exit Criteria
- Devil’s Advocate finds zero blocking critical/high issues
- TypeScript clean
- tests passing at or above 228
- build clean
- blackboard POST confirmed working
- all Wave 1 and Wave 2 findings complete
- consensus score 1.0
- current-tree rerun confirms no regressions

### Data Integrity Exit Criteria
- YAML drift resolved for core labels
- excise duty handling verified
- ΔOther OA residual meaningfully reduced or explained
- top unmapped labels triaged and documented
- novel label variants surfaced rather than dropped

### UX / Production Exit Criteria
- 401 shared sync message is contextual
- PM threshold aligns with policy/registry
- auth-required routes fail closed
- no serious production auth/persistence ambiguities remain

---

## Part 7: Canonical Launch Prompt

```text
You are AFES Round Two Orchestrator.

Company analysed: VST Industries (VST.NSE), 15 periods, Capitaline Ind AS data.
Session: 2026-04-08-round2
Blackboard: .afes-blackboard.json
Report: docs/session-progress-report-2026-04-08.md
Baseline: current main branch, 228/228 tests, TypeScript clean.

MISSION:
Fix the evidence-based VST production issues using a 12-agent Wave 1 audit, 3-agent Wave 2 synthesis, iterative fix batches, and current-tree rerun closure.

MANDATORY PRE-FLIGHT:
Run all 8 pre-flight checks first.
Proceed only if go_nogo = GO.

WAVE 1:
Launch all 12 specialist agents in parallel.
They return structured JSON only.
Orchestrator writes the blackboard.
Do not begin Wave 2 until the required evidence is persisted.

WAVE 2:
- conflict resolution
- implementation planning
- consensus evaluation

RULES:
1. Blackboard is the coordination primitive
2. Subagents return JSON; orchestrator writes shared state
3. Devil’s Advocate overrides optimistic assessments on trust/safety
4. Fix mathematical correctness before UX improvements
5. Closure requires current-tree evidence only
6. Never auto-mutate canonical mappings from cluster suggestions
7. Fail closed on production auth paths
8. No fix batch may reduce test count below 228

EXIT CONDITIONS:
- RE-ReOI gap < 5%
- reconciliation residual < 10%
- unexplained A9 failures = 0
- zero critical blocking findings
- TypeScript clean
- tests clean
- build clean
- blackboard POST confirmed
- consensus_score = 1.0

Begin pre-flight now. Do not ask for human input.
```

---

## Part 8: Session Report Update After Launch

After pre-flight completes, append a launch note to:
- `docs/session-progress-report-2026-04-08.md`

Include:
- VST evidence summary
- pre-flight status
- baseline counts
- wave launch status
- fix batch progress

---

## Metadata

Version: 2026-04-afes-round2-launch  
Evidence items: 8  
Wave 1 agents: 12  
Wave 2 agents: 3  
Total agents: 15  
Pre-flight checks: 8  
Baseline tests: 228  

This document is the normalized Round Two launch brief and is ready to be used directly for a future AFES stabilization round.
