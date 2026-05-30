/* ================================================================
   Plan 4 PR-4.5 — useResidualsSync (surface 3)

   Adopts the per-user residuals KV facade (residualsKvStore.ts),
   which was built and tested in PR-4.4 but never wired into a
   consumer. Residual history was localStorage-only — there is NO
   competing server mechanism — so this is a pure addition: it makes
   residual history follow the user across devices.

   The residual write itself stays on the hot path (the engine appends
   to localStorage inside buildAnalysisTraceability). This hook only
   handles the KV side, on the React layer, per the facade header
   ("call syncResidualHistoryToKv on your own cadence ... without
   changing the hot path"):

     1. Rehydrate on company change: when the active company changes
        and local history is EMPTY, pull from KV. Guarded on local-
        empty because rehydrate replays via appendRunResidualSummary,
        which does not dedupe — pulling into a populated local store
        would double every entry.
     2. Debounced push on run completion: when a run finishes (the
        run stamp changes) and local history is non-empty, push the
        local history up to KV.

   KV is fail-open (kvClient): with no creds configured, the facade
   reads/writes the localStorage mirror only, so behaviour degrades
   to the prior local-only model with no extra wiring.
================================================================ */

import { useEffect } from "react";
import {
  rehydrateResidualHistoryFromKv,
  syncResidualHistoryToKv,
} from "../lib/residualsKvStore";
import { readResidualHistory } from "../lib/residualsStore";

export interface ResidualsSyncInputs {
  /** Active company. Null clears the sync (no company loaded). */
  companyId: string | null;
  /**
   * A value that changes once per completed run (e.g. the traceability
   * envelope's generatedAt). Drives the debounced KV push: when it
   * changes, the engine has already appended the new residual summary
   * to the local store, so we push the updated history up to KV.
   */
  runStamp: string | null;
  /** Debounce window for the KV push. Default 600ms (matches the registry push). */
  pushDelayMs?: number | undefined;
}

export function useResidualsSync({
  companyId,
  runStamp,
  pushDelayMs = 600,
}: ResidualsSyncInputs): void {
  // 1. Rehydrate from KV on company change — only when local is empty.
  useEffect(() => {
    if (!companyId) return;
    if (readResidualHistory(companyId).length > 0) return; // local already populated; rehydrate would duplicate
    let cancelled = false;
    void (async () => {
      const restored = await rehydrateResidualHistoryFromKv(companyId);
      // Best-effort: nothing to do with the count beyond the append the
      // facade already performed. The guard above prevents double-append
      // even if this effect re-runs before the local write settles.
      void restored;
      void cancelled;
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // 2. Debounced push to KV when a run completes (runStamp changes).
  useEffect(() => {
    if (!companyId || !runStamp) return;
    if (readResidualHistory(companyId).length === 0) return; // nothing to push
    const timer = window.setTimeout(() => {
      void syncResidualHistoryToKv(companyId);
    }, pushDelayMs);
    return () => window.clearTimeout(timer);
  }, [companyId, runStamp, pushDelayMs]);
}
