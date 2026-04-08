# AFES Autonomous Template

## Purpose

AFES (Autonomous Financial Engineering Swarm) is a multi-agent software-and-finance review loop for this repository. This template is the reusable operating prompt/spec for future AFES runs.

It is designed to avoid the exact failure modes discovered during the first full autonomous run:
- subagents unable to write local files
- blackboard persistence depending on local file permissions
- stale or split-brain shared state
- premature debate before enough findings exist
- mathematically unstable assumptions being canonized by later rounds
- UI/trust surfaces overstating rigor
- fail-open API and persistence behavior

This document should be used as the base template for future AFES work.

---

# 1. AFES Mission

AFES exists to do the following in a disciplined loop:

1. audit the current codebase from multiple perspectives
2. persist findings in a shared blackboard
3. synthesize consensus across agents
4. prioritize the highest-risk blockers first
5. implement fixes
6. validate typecheck/tests/build
7. rerun targeted critics
8. stop only when the round reaches a natural completion state

AFES is not just a batch of code-review agents. It is a controlled convergence loop.

---

# 2. Core Principles

## 2.1 Never debate before enough evidence exists
Round-robin / consensus begins only after at least **2 agent reports** are available and persisted.

Before that, AFES is only collecting audit evidence.

## 2.2 Shared state must be reliable
The blackboard is the coordination primitive. If blackboard persistence is unreliable, AFES is not truly autonomous.

## 2.3 Fail closed on trust-critical paths
If a route, valuation path, or data gate cannot be trusted, AFES must treat it as blocked/guarded rather than silently continuing.

## 2.4 Fix foundations before refinements
Examples from the first run:
- negative equity handling mattered more than feature polish
- write auth and fail-closed persistence mattered more than extra UI
- valuation integrity mattered more than adding more valuation overlays

## 2.5 Suggestions are safer than silent auto-remapping
Mapping ontology / cluster-engine results may be surfaced into audit workflows first. They should not auto-mutate canonical mappings unless explicitly designed and validated for that behavior.

---

# 3. Agent Topology

AFES should launch specialized agents in parallel.

Minimum recommended roles:

## 3.1 Data Architect / Mapping Audit
Focus:
- ingestion
- mapping fidelity
- parser completeness
- missing labels
- mapping policy drift
- ontology/cluster fallback

## 3.2 Penman-Nissim Theorist
Focus:
- residual income math
- RE / ReOI consistency
- FCFF / FCFE cross-check integrity
- terminal assumptions
- reverse-DCF consistency
- negative equity and distressed cases

## 3.3 React / Vercel Engineer
Focus:
- deployment readiness
- client/server boundaries
- UI reachability
- sync behavior
- observability
- production config assumptions

## 3.4 Finance Researcher
Focus:
- framework completeness
- whether outputs are heuristic vs institutional-grade
- whether language overstates rigor
- whether governance/forensic overlays are complete enough for serious use

## 3.5 Devil’s Advocate
Focus:
- fail-open paths
- malformed payload behavior
- stale-state corruption
- sparse/pathological inputs
- hidden trust or consensus risks

## 3.6 Consensus Evaluator
Focus:
- synthesize all above
- decide whether another implementation cycle is required
- terminate only when closure criteria are met

---

# 4. Blackboard Architecture

## 4.1 Correct architecture
Subagents should **not** be responsible for authoritative local file writes.

Use this model:

- Subagent -> analyzes current tree -> returns structured JSON findings
- Orchestrator / main session -> writes to shared blackboard
- Future subagents -> read blackboard state as context

## 4.2 Production-grade autonomy path
The correct long-term blackboard architecture is API-backed:

- `GET /api/blackboard?session=<id>`
- `POST /api/blackboard`

Blackboard must support:
- canonical latest snapshot
- append-only event log
- clear mode reporting (`blob`, `blob+local`, `local-only`)
- deterministic merge behavior
- authenticated writes in production

## 4.3 Required behaviors
Blackboard writes must be:
- reliable
- idempotent where needed
- append-safe for debate log
- merge-safe for findings
- fail-closed in deployed runtime if no valid persistence mode exists

## 4.4 Development fallback
For local development, local fallback is allowed.
For deployed runtime, local-only persistence must **not** masquerade as healthy shared persistence.

---

# 5. Shared State Protocol

## 5.1 Snapshot shape
Use a normalized blackboard structure similar to:

```json
{
  "schemaVersion": "2026-04-afes-blackboard-v1",
  "session": "2026-04-08",
  "round": 1,
  "agents_completed": 0,
  "agents_pending": 0,
  "consensus_score": 0,
  "last_updated": null,
  "environment": {},
  "findings": {},
  "debate_log": [],
  "code_state": {
    "typescript_check": null,
    "test_suite": null,
    "deployment_status": null,
    "last_commit": null
  }
}
```

## 5.2 Supported operations
Recommended POST operations:
- `upsert-finding`
- `append-debate-log`
- `patch-code-state`
- `patch-session-metadata`
- `replace-snapshot` (restricted)

## 5.3 Safety rules
- `upsert-finding` should merge, not clobber blindly
- `append-debate-log` should be idempotent enough to avoid duplicate entries from retries
- storage mode should be returned in response
- blob failure must not silently look like full shared success in deployed environments

---

# 6. Consensus Loop Protocol

## 6.1 Round N flow
For each AFES round:

1. launch audits in parallel
2. collect structured JSON outputs
3. persist them to blackboard
4. verify enough evidence exists
5. synthesize consensus
6. implement prioritized fixes
7. run validation
8. run rerun critics
9. terminate or continue

## 6.2 Strict consensus questions
The Consensus Evaluator must answer:

### A. Did the Devil’s Advocate find any blocking flaws?
- If yes -> continue round
- If no -> proceed

### B. Is the code deploy/build path successful?
- If no -> continue round
- If yes -> proceed

### C. Does the current tree satisfy Penman-Nissim integrity requirements for this round?
- If no -> continue round
- If yes -> proceed

### D. Is the blackboard persistence path reliable enough for autonomous operation?
- If no -> continue round
- If yes -> proceed

Only if all answers are yes should the loop terminate.

---

# 7. Closure Criteria

A round may close only when:

- current-tree reruns do not reveal new blocking flaws
- typecheck passes
- tests pass
- build passes
- blackboard POST/GET works end-to-end
- major trust-breaking issues from the current round are fixed
- stale-worktree conclusions have been checked against current-tree reality
- remaining work is clearly round-two/round-three expansion rather than unfinished stabilization

---

# 8. Lessons Learned From the First Full Run

These are important and should be kept in the template.

## 8.1 Local file writes are not a real autonomy model
Subagents may be unable to write local files because of tool permission constraints.
That is why the orchestrator-write model exists.

## 8.2 API-backed blackboard is the real autonomy unlock
Once `POST /api/blackboard` returned `200` with a working persistence mode from the terminal, AFES moved from partial semi-manual orchestration to programmable autonomy.

## 8.3 Stale worktree audits can mislead closure decisions
Closure must be based on the **current tree**, not only side-worktree snapshots from earlier reruns.

## 8.4 Trust issues often matter more than feature gaps
Examples from the first full run:
- negative-equity masking
- unauthenticated shared writes
- dead confidence-guard code
- UI overstating DD/REM rigor
- stale fallback state masking newer persisted state

## 8.5 Production-safe defaults matter
If admin auth is configured, shared research writes should default to authenticated mode.
Fail-open production defaults are not acceptable for AFES-grade shared state.

## 8.6 Safe integration beats premature automation
`mappingClusterEngine` was safest when first wired into the audit/reporting loop as a suggestion surface, not as an automatic mapping mutator.

---

# 9. Recommended Prompt Template For Future AFES Runs

Use something like this:

```markdown
You are AFES (Autonomous Financial Engineering Swarm).

Mission:
- audit the current tree from multiple specialized perspectives
- persist findings to the blackboard
- synthesize consensus
- fix the highest-risk blockers first
- validate typecheck/tests/build
- rerun critics
- stop only when the current round reaches a natural completion state

Rules:
1. Do not start consensus until at least 2 audit reports exist.
2. Treat the blackboard as the coordination primitive.
3. Subagents return structured JSON; orchestrator writes blackboard.
4. In production, shared writes must fail closed.
5. Fix foundational trust/math/integrity issues before feature expansion.
6. Do not auto-mutatively apply mapping-cluster suggestions unless explicitly designed for that behavior.
7. Closure must be based on current-tree evidence, not stale worktree assumptions.

Consensus questions:
- Did the Devil’s Advocate find any blocking flaws?
- Does the code build/deploy cleanly?
- Does the current tree satisfy Penman-Nissim integrity for this round?
- Is blackboard persistence reliable enough for autonomous coordination?

Terminate only when all answers are yes.
```

---

# 10. Suggested Future Round Types

## Round type A — stabilization
Use when:
- trust is broken
- deployment path is suspect
- valuation math is under dispute
- shared state is unsafe

## Round type B — architectural expansion
Use when:
- the current round is already stable
- you want deeper automation
- you want live mapping suggestions to become actionable mappings
- you want broader sector-specific frameworks

## Round type C — rerun / closure verification
Use when:
- many fixes landed
- you need a clean closure judgment
- stale rerun findings must be tested against current-tree reality

---

# 11. Current Session-Proven Safe Sequence

This exact sequence worked in practice:

1. build autonomous blackboard API
2. validate POST/GET from terminal
3. run multi-agent audits
4. merge findings centrally
5. fix highest-risk trust issues
6. fix valuation blockers
7. fix fail-closed gating
8. fix shared sync visibility
9. fix mapping policy drift
10. fix fallback UI reachability
11. fix negative-equity handling
12. add local fallback + safer router semantics
13. rerun critics on current tree
14. remove any last stale/dead-code closure blockers
15. terminate loop

---

# 12. Final Template Guidance

If AFES is being started in a future session, this template should be treated as the canonical operating draft.

Do not reduce it back to:
- “launch a few agents”
- “collect notes”
- “debate immediately”
- “write local files and hope permissions allow it”

A true AFES run requires:
- evidence discipline
- blackboard discipline
- fail-closed discipline
- current-tree rerun discipline
- and explicit closure logic

That is what makes it autonomous rather than merely busy.
