/* ================================================================
   Plan 4 PR-4.2 — auditRunStore.ts

   Per-user audit run persistence. Saves the AnalysisTraceability
   envelope and minimal run metadata to KV (with localStorage
   mirror), keyed under userScopedKey('audit-run:<runId>').

   Anonymous users: 30-day TTL.
   Authenticated users: never expire.

   This module is the persistence facade for audit runs. PR-4.2 only
   ships the facade + tests. Wiring into the App.tsx save flow is
   a follow-up — adoption is gated on the user choosing whether
   audit history should be cross-device.

   Why a separate module instead of extending sharedResearchApi:
     - sharedResearchApi is server-blob-backed for cross-tenant
       comparison registries. Audit runs are per-user and want a
       different blast radius (a KV outage shouldn't wipe a
       reviewer's local history).
     - Keeps the migration from sharedResearchApi to KV reversible.
================================================================ */

import { kvGet, kvSet, kvDelete } from "./kvClient";
import { userScopedKey, ttlForCurrentUser } from "./identity";
import type { AnalysisTraceabilityEnvelope } from "../engine/analysisTraceability";

/** Stored shape — small enough that we can ship it via KV REST. */
export interface AuditRunRecord {
  runId: string;
  companyId: string | null;
  generatedAt: string;
  /** The envelope schemaVersion at write time — used by reads to detect stale records. */
  envelopeSchemaVersion: string;
  /** Pipeline strategy id (Plan 3 PR-3.5 stamp). May be undefined for older records. */
  pipelineStrategyId?: string;
  /** Compact summary the reviewer surface can render without rebuilding the full envelope. */
  summary: {
    rigorLevel: string | null;
    valuationStatus: string | null;
    blockingCount: number;
    diagnosticCount: number;
  };
  /** Full envelope so the run can be re-rendered without recomputing. */
  envelope: AnalysisTraceabilityEnvelope;
}

const INDEX_KEY = "audit-run:index";

/** Build the KV key for a single run. */
function runKey(runId: string): string {
  return userScopedKey(`audit-run:${runId}`);
}

function indexKey(): string {
  return userScopedKey(INDEX_KEY);
}

interface AuditRunIndexEntry {
  runId: string;
  companyId: string | null;
  generatedAt: string;
}

interface AuditRunIndex {
  /** Most recent first. */
  entries: AuditRunIndexEntry[];
}

const EMPTY_INDEX: AuditRunIndex = { entries: [] };

/** Save an audit run for the current user. Mirrors to localStorage immediately. */
export async function saveAuditRun(record: AuditRunRecord): Promise<void> {
  const ttl = ttlForCurrentUser();
  await kvSet<AuditRunRecord>(runKey(record.runId), record, ttl);

  // Update the index. Read-modify-write — KV doesn't give us atomic
  // append, but per-user indexes are small enough that lost updates
  // (two tabs writing the same record concurrently) just produce a
  // duplicate entry that the loader can dedupe.
  const idxResult = await kvGet<AuditRunIndex>(indexKey());
  const existing = idxResult.value ?? EMPTY_INDEX;
  const filtered = existing.entries.filter((e) => e.runId !== record.runId);
  const next: AuditRunIndex = {
    entries: [
      { runId: record.runId, companyId: record.companyId, generatedAt: record.generatedAt },
      ...filtered,
    ].slice(0, 200), // cap so KV size stays bounded for heavy reviewers
  };
  await kvSet<AuditRunIndex>(indexKey(), next, ttl);
}

/** Load a single run by runId. Returns null if absent. */
export async function loadAuditRun(runId: string): Promise<AuditRunRecord | null> {
  const result = await kvGet<AuditRunRecord>(runKey(runId));
  return result.value;
}

/** List recent runs for the current user, most recent first. */
export async function listAuditRuns(): Promise<AuditRunIndexEntry[]> {
  const result = await kvGet<AuditRunIndex>(indexKey());
  if (!result.value) return [];
  // Dedupe by runId, preserving most-recent ordering.
  const seen = new Set<string>();
  const deduped: AuditRunIndexEntry[] = [];
  for (const entry of result.value.entries) {
    if (seen.has(entry.runId)) continue;
    seen.add(entry.runId);
    deduped.push(entry);
  }
  return deduped;
}

/** Delete a run. Removes both the record and the index entry. */
export async function deleteAuditRun(runId: string): Promise<void> {
  await kvDelete(runKey(runId));
  const idxResult = await kvGet<AuditRunIndex>(indexKey());
  if (!idxResult.value) return;
  const next: AuditRunIndex = {
    entries: idxResult.value.entries.filter((e) => e.runId !== runId),
  };
  await kvSet<AuditRunIndex>(indexKey(), next, ttlForCurrentUser());
}
