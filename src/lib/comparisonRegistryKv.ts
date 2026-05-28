/* ================================================================
   Plan 4 PR-4.3 — comparisonRegistryKv.ts

   Per-user comparison registry persistence on KV. Layered ON TOP of
   the existing localStorage path in companyRegistryStore.ts — does
   not replace it. The writer pushes to both targets; the reader
   prefers KV when available and falls through to local.

   This keeps the existing UX intact while opening cross-device sync
   for users who opt in. PR-4.5 (follow-up) will wire the
   useRegistryPersistence hook to call into here when KV creds are
   present.

   The shared comparison registry (sharedResearchApi.ts) is a SEPARATE
   surface — it's a global blob that tenants share. KV scope is
   per-user. The two co-exist deliberately:

     local           -> single-tab fallback
     KV (per-user)   -> cross-device sync for the same user
     shared blob     -> cross-tenant comparison pool

   The reader merges in priority order: KV beats local; shared blob
   is a separate concern handled by the existing sharedResearchApi.
================================================================ */

import { kvGet, kvSet } from "./kvClient";
import { userScopedKey, ttlForCurrentUser } from "./identity";
import { CompanyRegistry } from "../engine/types";
import {
  buildCompanyRegistrySnapshot,
  readCompanyRegistrySnapshot,
} from "./companyRegistrySnapshot";

const KEY = "comparison-registry";

/** Save to KV (and localStorage mirror, via kvSet). */
export async function saveComparisonRegistryToKv(registry: CompanyRegistry): Promise<void> {
  const snapshot = buildCompanyRegistrySnapshot(registry);
  await kvSet(userScopedKey(KEY), snapshot, ttlForCurrentUser());
}

/**
 * Load the comparison registry. Returns null when nothing is
 * persisted under the current user — caller should fall through to
 * companyRegistryStore.readPersistedCompanyRegistry().
 */
export async function loadComparisonRegistryFromKv(): Promise<CompanyRegistry | null> {
  const result = await kvGet<unknown>(userScopedKey(KEY));
  if (result.value == null) return null;
  try {
    return readCompanyRegistrySnapshot(result.value);
  } catch {
    // Stale schema or corrupted snapshot — caller will fall through
    return null;
  }
}
