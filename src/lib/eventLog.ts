/* ================================================================
   Plan 9 PR-9.2 — Immutable hash-chained event log.

   Critical operations (lock evidence, override a parser cell,
   delete a saved run) MUST leave a tamper-evident audit trail.
   A flat append-only list isn't enough — anyone with KV write
   access could rewrite history. A hash chain forces the auditor
   to detect any post-hoc edit.

   Each LogEntry carries:
     - id (monotonic)
     - timestamp
     - actorId
     - kind (e.g. "evidence-locked", "manual-override")
     - payload
     - prevHash (SHA-256 of the previous serialized entry, or "0" * 64
       for the genesis entry)

   Verifying the chain re-walks every entry, recomputing the
   prevHash from the prior entry's canonical form. If any entry
   has been mutated, the recomputed prevHash diverges and the
   verifier flags the break-point.

   This module ships pure logic; KV / blob persistence is layered
   on top in a follow-up (eventLogStore.ts).
================================================================ */

import { canonicalize, reproducibilityHash } from "./evidenceLocking";

export type EventKind =
  | "evidence-locked"
  | "manual-override"
  | "run-deleted"
  | "registry-merged"
  | "schema-migrated";

export interface LogEntryInput {
  actorId: string;
  kind: EventKind;
  payload: Record<string, unknown>;
}

export interface LogEntry {
  id: number;
  timestamp: string;
  actorId: string;
  kind: EventKind;
  payload: Record<string, unknown>;
  /** SHA-256 of the prior entry's canonical form. "0" * 64 for genesis. */
  prevHash: string;
}

export const GENESIS_HASH = "0".repeat(64);

/** Append a new entry, computing prevHash from the current tail. */
export async function appendEntry(
  log: LogEntry[],
  input: LogEntryInput,
): Promise<LogEntry[]> {
  const tail = log[log.length - 1];
  const prevHash = tail ? await reproducibilityHash(tail as unknown as Record<string, unknown>) : GENESIS_HASH;
  const entry: LogEntry = {
    id: log.length,
    timestamp: new Date().toISOString(),
    actorId: input.actorId,
    kind: input.kind,
    payload: input.payload,
    prevHash,
  };
  return [...log, entry];
}

export interface VerifyResult {
  valid: boolean;
  /** Index where verification failed; -1 if valid end-to-end. */
  brokenAt: number;
  /** Human-readable reason for the failure. */
  reason?: string | undefined;
}

export async function verifyChain(log: LogEntry[]): Promise<VerifyResult> {
  for (let i = 0; i < log.length; i++) {
    const entry = log[i]!;

    // Genesis entry must reference the GENESIS_HASH
    if (i === 0) {
      if (entry.prevHash !== GENESIS_HASH) {
        return { valid: false, brokenAt: 0, reason: "Genesis prevHash is not 0x00...00" };
      }
      continue;
    }

    const prior = log[i - 1]!;
    const expected = await reproducibilityHash(prior as unknown as Record<string, unknown>);
    if (entry.prevHash !== expected) {
      return {
        valid: false,
        brokenAt: i,
        reason: `Entry ${i} prevHash diverges — log was tampered between entries ${i - 1} and ${i}`,
      };
    }
  }

  return { valid: true, brokenAt: -1 };
}

/** Pure helper: get the canonical form of an entry (for off-chain audits). */
export function entryCanonical(entry: LogEntry): string {
  return canonicalize(entry as unknown as Record<string, unknown>);
}
