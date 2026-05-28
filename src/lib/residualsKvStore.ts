/* ================================================================
   Plan 4 PR-4.4 — residualsKvStore.ts

   Per-user residual history sync. Layered ON TOP of the existing
   localStorage path in residualsStore.ts. Same pattern as PR-4.3:
   reader prefers KV when populated, falls through to local; writer
   pushes to both.

   Why a facade rather than rewriting residualsStore:
     - residualsStore is hot-path code (every analysis run appends).
       A KV write on each append would trade local latency for a
       network round trip the user can't see.
     - The local store already handles eviction (5MB cap, oldest
       drops first). KV doesn't need that — keys are bounded per
       user and Vercel KV has its own retention.
     - This facade lets adopters call syncResidualHistoryToKv on
       their own cadence (e.g. when a "save run" gesture fires)
       without changing the hot path.

   Adoption is gated. PR-4.5 will wire useResidualsSync (a follow-up
   hook) into App.tsx to debounce-pull on user gesture.
================================================================ */

import { kvGet, kvSet } from "./kvClient";
import { userScopedKey, ttlForCurrentUser } from "./identity";
import { readResidualHistory, appendRunResidualSummary, type RunResidualSummary } from "./residualsStore";

const KEY_PREFIX = "residuals:";

function companyKey(companyId: string): string {
  return userScopedKey(`${KEY_PREFIX}${companyId}`);
}

/**
 * Push the current localStorage history for a company up to KV.
 * No-op if the local history is empty.
 */
export async function syncResidualHistoryToKv(companyId: string): Promise<void> {
  const local = readResidualHistory(companyId);
  if (local.length === 0) return;
  await kvSet<RunResidualSummary[]>(companyKey(companyId), local, ttlForCurrentUser());
}

/**
 * Pull the residual history for a company from KV. Returns null
 * when nothing is stored under the current user. Does NOT mutate
 * local — callers decide whether to merge (rebuild local) or just
 * display the cross-device view.
 */
export async function loadResidualHistoryFromKv(companyId: string): Promise<RunResidualSummary[] | null> {
  const result = await kvGet<RunResidualSummary[]>(companyKey(companyId));
  return result.value;
}

/**
 * One-shot rehydrate: pulls KV history and replays each entry into
 * the local store via appendRunResidualSummary. Idempotent — the
 * append path tolerates duplicate runIds (the local store keys by
 * insertion order, so duplicate runs become duplicate entries; the
 * UI can dedupe at render time if it cares).
 *
 * Used on app boot when KV creds are present and local is empty.
 */
export async function rehydrateResidualHistoryFromKv(companyId: string): Promise<number> {
  const remote = await loadResidualHistoryFromKv(companyId);
  if (!remote) return 0;
  let appended = 0;
  for (const entry of remote) {
    appendRunResidualSummary(entry);
    appended++;
  }
  return appended;
}
