# Plan 8 — Reviewer Experience (3 PRs, schema v16 → v17)

> **For Hermes:** Use `subagent-driven-development` skill. This plan adds the *reviewer-side* features that distinguish a "tool the analyst uses" from a "platform a review committee uses". Annotation, run-diff, citation-per-cell, evidence locking, reproducibility hash.

**Goal:** Move the audit experience from "look at numbers and trust them" to "interrogate every number, lock evidence, compare runs, prove reproducibility".

**Architecture:** Each feature is a UI surface backed by a KV-stored artifact (Plan 4) plus an envelope field (schema v17).

**Tech Stack:** No new runtime deps. Use existing React + Tailwind + KV stack.

**Sequencing rule:** All three PRs depend on Plan 4 (KV) being landed. Within Plan 8, PR-8.1 (annotation) → PR-8.2 (run-diff) → PR-8.3 (evidence locking + reproducibility).

---

## PR-8.1 — Inline annotation + comments

**Branch:** `reviewer/inline-annotations`
**Schema bump:** v16 → v16.5 (additive)
**Estimated diff:** +1,800 / -200, 5 new files

**Why:** Today, a reviewer writes notes in a separate document and emails them. There's no way to attach a comment to a specific cell, period, or ratio. The audit trail lives in someone's inbox, not the run.

**Domain spec:**

Each annotation:
- `annotationId`: UUID
- `runId`: which run is being annotated
- `target`: structured selector (cell-level: `{ kind: "cell", sheet: "Recast", period: "2025-03-31", metric: "RNOA" }`; section-level: `{ kind: "section", sheet: "Valuation", anchor: "intrinsic-value" }`)
- `author`: `{ userId, displayName }`
- `createdAt`: ISO timestamp
- `body`: markdown (sanitized via Plan 6 PR-6.1 helper)
- `status`: `"open" | "resolved" | "wontfix"`
- `replies`: array of `{ author, createdAt, body }`

KV key: `penman:annotations:<runId>` — stores list, append-only.

**Steps:**

1. Define types in `src/engine/types/annotation.ts`.
2. Build `api/kv/annotations/[runId].ts` — `GET` (list), `POST` (append), `PATCH` (status change).
3. Build `useAnnotations(runId)` hook with optimistic UI.
4. Build `<AnnotatableCell>` wrapper component:
   ```tsx
   <AnnotatableCell target={{ kind: "cell", sheet: "Recast", period, metric: "RNOA" }}>
     {formatPercent(rnoa)}
   </AnnotatableCell>
   ```
   Renders the value normally; shows comment-bubble icon on hover; popover for inline thread.
5. Build `<AnnotationDrawer>` — right-side drawer listing all annotations on the active run, filterable by status, sortable by date.
6. Wire into 5 high-traffic surfaces: Recast Statements, Valuation, Quality, V3 Analytics, Forecast.
7. Permissions: any user with KV access can annotate. `delete` is author-only. `status` change is author or run-creator.
8. Add to Excel export: workbook gets a "Reviewer Comments" sheet with all annotations, sortable.
9. Tests: 14 cases — append, list, reply, status change, delete-by-author, permission rejection, optimistic UI rollback on failure.

**Acceptance test:**

```bash
npm run test:e2e -- --grep "@annotations"   # E2E green
npx vitest run src/components/__tests__/AnnotationDrawer.spec.tsx   # 14 unit tests
# Manual: cell-level comment from User A is visible to User B in real-time (within 5s)
```

---

## PR-8.2 — Run diff (compare two audit runs side-by-side)

**Branch:** `reviewer/run-diff`
**Schema bump:** none
**Estimated diff:** +1,400 / -150

**Why:** A reviewer asks "what changed between the run from last quarter and this quarter?" Today, the answer is "open both, eyeball them". With 30+ tabs of data, that's not auditable. Run-diff makes the answer a structured artifact.

**Domain spec:**

Given two `runId`s for the same `companyId`:
- Compare envelopes field-by-field, classify each diff:
  - `unchanged`: values identical (or within tolerance)
  - `numeric-shift`: value changed within tolerance (default ±5%)
  - `material-change`: value changed by > 5%
  - `regime-change`: status enum changed (e.g. `clean → conflicts-present`)
  - `added`: present in B, absent in A
  - `removed`: present in A, absent in B
- Diffs grouped by section: Parser, Reconciliation, Concept Identity, Economic Sanity, Unusual Items, Valuation, Lineage, Residuals
- Material changes ranked by impact magnitude

**Target API:**

```ts
// src/engine/diff/envelopeDiff.ts
export interface EnvelopeDiff {
  fromRunId: string;
  toRunId: string;
  companyId: string;
  generatedAt: string;
  sections: {
    name: string;
    changes: DiffEntry[];
    materialCount: number;
  }[];
  summary: { unchanged: number; shifted: number; material: number; regime: number };
}

export interface DiffEntry {
  path: string;                   // e.g. "valuation.intrinsicValuePerShare"
  classification: "unchanged" | "numeric-shift" | "material-change" | "regime-change" | "added" | "removed";
  fromValue: unknown;
  toValue: unknown;
  delta?: number;
  deltaPct?: PercentFraction;
  ranking?: number;               // 1 = most impactful
  narrative?: string;             // auto-generated description
}

export function diffEnvelopes(a: AnalysisTraceabilityEnvelope, b: AnalysisTraceabilityEnvelope): EnvelopeDiff;
```

**Steps:**

1. Implement `diffEnvelopes` with deterministic deep-walk + classification rules.
2. Build `<RunDiffView>` — split-pane UI showing full envelope on left, diff overlay on right with material changes highlighted.
3. Add "Compare runs" entry in run-list dropdown: select two runs → land on diff view.
4. Add diff export to Excel: workbook with "Run Comparison" sheet showing every diff entry.
5. Permissions: anyone who can read both runs can diff them.
6. Tests: 18 cases — identity diff (no changes), single-numeric-shift, multi-section material-change, regime change, added/removed, ranking correctness, deterministic output (same inputs → same output).

**Acceptance test:**

```bash
npx vitest run src/engine/diff/__tests__/envelopeDiff.spec.ts   # 18 green
# Manual: diff Bajaj Finance Q1 vs Q2 → top 5 material changes ranked by impact
```

---

## PR-8.3 — Evidence locking + reproducibility hash

**Branch:** `reviewer/evidence-locking-and-hash`
**Schema bump:** v16 → v17 (adds `reproducibility` block + `lockState`)
**Estimated diff:** +1,100 / -100

**Why:** Two requirements:
1. **Evidence locking:** once a reviewer signs off, the run becomes immutable. Re-running the pipeline on the same inputs creates a new run; the locked one is preserved as audit evidence.
2. **Reproducibility hash:** the same inputs through the same code MUST produce a bit-identical envelope. If the hash differs across two Vercel deploys, that's a non-determinism bug in the engine.

**Domain spec:**

Reproducibility hash:
- Canonical envelope serialization (sorted keys, fixed ISO timestamps stripped from `generatedAt`/`runContext.startedAt`, all numbers serialized to fixed precision)
- SHA-256 of the canonical bytes
- Stored in envelope as `reproducibility.envelopeHash`

Lock state:
- `unlocked`: editable, mutable (default for new runs)
- `signed-off`: immutable, signed by `signedBy` at `signedAt`. Cannot be deleted; cannot be mutated. Annotations are still allowed (they're separate KV namespace).
- `archived`: locked + hidden from default run-list. KV TTL 7 years (audit retention).

**Target additions:**

```ts
// extend envelope
{
  reproducibility: {
    envelopeHash: string;            // SHA-256 hex of canonical bytes
    canonicalizationVersion: string; // "2026-06-canonical-v1"
    inputsHash: string;              // SHA-256 of (rawData | config | policyVersions)
  };
  lockState: {
    state: "unlocked" | "signed-off" | "archived";
    signedBy?: { userId: string; displayName: string };
    signedAt?: string;
    archivedAt?: string;
    signOffNote?: string;
  };
}
```

**Steps:**

1. Implement canonicalization in `src/engine/reproducibility/canonical.ts`:
   ```ts
   export function canonicalize(env: AnalysisTraceabilityEnvelope): Uint8Array {
     // 1. clone
     // 2. strip non-deterministic fields (generatedAt, runContext.startedAt)
     // 3. sort keys recursively
     // 4. round numbers to 1e-9 precision (deterministic)
     // 5. JSON.stringify with stable replacer
     // 6. encode UTF-8
   }
   export function envelopeHash(env: AnalysisTraceabilityEnvelope): string {
     return sha256Hex(canonicalize(env));
   }
   ```
2. Compute hash on every envelope build; store in envelope itself. (Yes — the hash is computed on a clone-without-hash to avoid self-reference.)
3. Build sign-off UI: button on run header → modal asking for sign-off note → POST to `/api/kv/audit-runs/[runId]/sign-off`.
4. After sign-off:
   - All edit endpoints reject with 403 for that runId
   - Lock-state badge shows in run header
   - Workbook export adds "Locked by <name> on <date>" footer
5. Reproducibility verification: nightly job (cronjob) re-builds the envelope for the latest signed-off run on each company, compares hash. Mismatch → telemetry alert + `traceLogger` warning.
6. Tests: 16 cases — hash determinism (same inputs 100 runs identical), inputs-hash invariance under generatedAt drift, lock prevents mutation, unlock requires admin role, archived TTL, replay attack rejection.

**Acceptance test:**

```bash
# Determinism: build envelope twice from same inputs
node -e '
import("./src/engine/...").then(m => {
  const env1 = m.buildEnvelope(input);
  const env2 = m.buildEnvelope(input);
  console.assert(env1.reproducibility.envelopeHash === env2.reproducibility.envelopeHash);
})
'

# Lock enforcement
curl -X PUT /api/kv/audit-runs/RUN_ID -d '{...}'   # 200 (unlocked)
curl -X POST /api/kv/audit-runs/RUN_ID/sign-off   # 200
curl -X PUT /api/kv/audit-runs/RUN_ID -d '{...}'   # 403 (locked)

npx vitest run src/engine/reproducibility/__tests__/   # 16 green
```

---

## Cross-cutting acceptance for Plan 8

```bash
# ─── Annotation surface ────────────────────
grep -rn "AnnotatableCell\|AnnotationDrawer" src/components/ | wc -l   # ≥ 6 (5 surfaces + drawer)

# ─── Run diff works ────────────────────────
npx vitest run src/engine/diff/   # green
# Manual: compare Q1 / Q2 of any company → ranked diff visible

# ─── Reproducibility ──────────────────────
grep -rn "reproducibility\.envelopeHash\|canonicalize" src/   # ≥ 4 hits
grep -rn "lockState" src/engine/types/   # type defined

# ─── Schema v17 ──────────────────────────
grep TRACEABILITY_SCHEMA_VERSION src/engine/policyVersions.ts   # = "2026-06-traceability-v17"

# ─── Suite ───────────────────────────────
npm run validate
```

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Annotation comment spam | low | Per-user rate limit (express-rate-limit on POST /api/kv/annotations) |
| Hash determinism breaks on Node version drift | high | Explicit canonicalization version field; test runs on Node 20 + 22 |
| Lock bypass via direct KV access | medium | KV API routes enforce lock; direct KV access is dev-only and auth-protected |
| Run diff slow for large envelopes | medium | Diff is O(n) deep walk; envelope ≤ 50KB, completes < 50ms; cache hash-pair results in KV |
| Annotation visibility leaks across firms | high | KV key is `penman:annotations:<runId>`; runId is per-firm-scoped via Plan 4 identity |

## Definition of done

10/10 means:
1. Reviewers can comment on individual cells; threads are visible to all firm members
2. "Compare runs" feature shows ranked material changes between any two runs of the same company
3. Signed-off runs are immutable; reproducibility hash proves engine determinism
4. Excel exports carry annotations and lock-state metadata
5. Lock and hash semantics are documented in `docs/audit/reviewer-experience.md` for SEBI / SOX-style audits
