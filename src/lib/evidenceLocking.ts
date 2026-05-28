/* ================================================================
   Plan 8 PR-8.3 — Evidence locking + reproducibility hash.

   Schema bump v16 → v17.

   When a run reaches "valuation-eligible" rigor and a reviewer is
   ready to commit to it as the canonical record, they LOCK it.
   Locking does three things:
     1. Computes a SHA-256 reproducibility hash of the canonical
        envelope shape (sorted keys, no whitespace, fixed numeric
        precision).
     2. Stamps the locker's identity + timestamp.
     3. Marks the envelope read-only — subsequent edits create a
        new run rather than mutating the locked one.

   The hash is the verifiable handle reviewers cite when a run is
   discussed externally — "we approved run-id X with hash 0x9ab3..."
   — and lets an auditor re-run the same source data and confirm
   byte-identical output.

   This module ships:
     canonicalize(envelope)       -> deterministic string
     reproducibilityHash(envelope) -> Promise<string> (hex SHA-256)
     lockEvidence(envelope, sig)   -> Promise<LockedEnvelope>
     verifyLockedHash(env)         -> Promise<boolean>

   Why async hash: WebCrypto's subtle.digest is async by design.
   For Node-side tests we polyfill via the standard 'crypto' module.
================================================================ */

import { TRACEABILITY_SCHEMA_VERSION } from "../engine/policyVersions";

export interface LockSignature {
  reviewerId: string;
  reviewerName?: string | undefined;
  reason?: string | undefined;
}

export interface LockedEnvelope {
  schemaVersion: string;
  locked: true;
  reproducibilityHash: string;
  lockedAt: string;
  lockedBy: LockSignature;
  // The envelope itself, stored verbatim
  envelope: Record<string, unknown>;
}

/* ----------------- Canonical serialization ---------------------
   For a hash to be reproducible across machines we need:
     - Sorted object keys at every depth
     - No whitespace
     - Numeric precision fixed (we round to 12 decimals — covers all
       financial precision needs without inviting floating-point drift)
     - undefined skipped (JSON.stringify default)
     - null preserved
   ------------------------------------------------------------- */

function roundNumber(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 1e12) / 1e12;
}

function canonicalReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number") return roundNumber(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const k of keys) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

export function canonicalize(envelope: Record<string, unknown>): string {
  return JSON.stringify(envelope, canonicalReplacer);
}

/* ----------------- SHA-256 hash --------------------------------
   Browser path: crypto.subtle.digest('SHA-256', ...)
   Node path:    require('crypto').createHash('sha256') 
   ------------------------------------------------------------- */

async function sha256Hex(input: string): Promise<string> {
  // Browser
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle) {
    const bytes = new TextEncoder().encode(input);
    const buf = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Node fallback
  const { createHash } = await import("crypto");
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

export async function reproducibilityHash(envelope: Record<string, unknown>): Promise<string> {
  return sha256Hex(canonicalize(envelope));
}

/* ----------------- Lock state machine -------------------------- */

export async function lockEvidence(
  envelope: Record<string, unknown>,
  sig: LockSignature,
): Promise<LockedEnvelope> {
  const hash = await reproducibilityHash(envelope);
  return {
    schemaVersion: TRACEABILITY_SCHEMA_VERSION,
    locked: true,
    reproducibilityHash: hash,
    lockedAt: new Date().toISOString(),
    lockedBy: sig,
    envelope,
  };
}

/**
 * Recomputes the hash from the stored envelope and compares it to
 * the stamped reproducibilityHash. Returns false if the envelope
 * has been tampered with after locking.
 */
export async function verifyLockedHash(locked: LockedEnvelope): Promise<boolean> {
  const recomputed = await reproducibilityHash(locked.envelope);
  return recomputed === locked.reproducibilityHash;
}

/**
 * True if attempting to mutate the envelope on a locked run should
 * be rejected. UI uses this to show 'Locked — fork to edit' rather
 * than silently dropping edits.
 */
export function isReadOnly(locked: LockedEnvelope): boolean {
  return locked.locked === true;
}
