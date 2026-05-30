/* ================================================================
   Plan 2 PR-2.1 — useRegistryPersistence
   Plan 4 PR-4.5 — adopt the per-user KV comparison-registry facade

   Coordinates the registry-side effects:
     1. Hydrate on mount: per-user KV snapshot (cross-device, beats
        local) then the shared cross-tenant registry.
     2. Debounce the localStorage write (250ms coalesce window).
     3. Push to the shared registry after the user pauses (600ms).
     4. Write through to the per-user KV snapshot (same debounce),
        gated on hydration so a pre-hydrate empty state can't clobber
        a richer cross-device snapshot.

   KV is fail-open (kvClient): when no creds are configured it writes
   the localStorage mirror only, so behaviour degrades to the prior
   local+shared model with no extra wiring.

   The hook owns its own timers; consumers just pass the registry
   state and a setter.
================================================================ */

import { useEffect, useState } from "react";
import {
  fetchSharedComparisonRegistryWithStatus,
  syncSharedComparisonRegistryWithStatus,
} from "../lib/sharedResearchApi";
import {
  persistCompanyRegistry,
} from "../lib/companyRegistryStore";
import {
  loadComparisonRegistryFromKv,
  saveComparisonRegistryToKv,
} from "../lib/comparisonRegistryKv";
import { mergeCompanyRegistries } from "../lib/companyRegistrySnapshot";
import type { SharedApiResult } from "../lib/sharedResearchApi";
import type { CompanyRegistry } from "../engine/types";

export interface RegistryPersistenceOptions {
  /** Debounce window for localStorage writes. Default 250ms. */
  localWriteDelayMs?: number | undefined;
  /** Debounce window for shared-registry pushes. Default 600ms. */
  remoteSyncDelayMs?: number | undefined;
}

export interface RegistryPersistenceState {
  /** True after the initial shared-registry fetch resolves (success or fail). */
  comparisonRegistryHydrated: boolean;
  /** Status of the most recent shared-registry call (read or write). */
  sharedRegistryStatus: SharedApiResult<CompanyRegistry> | null;
}

/**
 * Coordinates persistence for the company registry:
 *   localStorage (debounced)  ←→  shared-registry API (debounced).
 *
 * @param registry  current registry state (full source of truth)
 * @param setRegistry React setter — used to merge in shared records on hydrate
 * @param options    optional debounce overrides
 */
export function useRegistryPersistence(
  registry: CompanyRegistry,
  setRegistry: (updater: (prev: CompanyRegistry) => CompanyRegistry) => void,
  options: RegistryPersistenceOptions = {},
): RegistryPersistenceState {
  const { localWriteDelayMs = 250, remoteSyncDelayMs = 600 } = options;
  const [comparisonRegistryHydrated, setComparisonRegistryHydrated] = useState(false);
  const [sharedRegistryStatus, setSharedRegistryStatus] = useState<SharedApiResult<CompanyRegistry> | null>(null);

  // 1. Hydrate on mount: per-user KV snapshot first (cross-device,
  //    beats the local fallback), then the shared cross-tenant registry.
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      // 1a. Per-user KV snapshot. Fail-open: returns null when no creds
      //     are configured or nothing is stored — caller keeps `prev`
      //     (already hydrated from localStorage by companyRegistryStore).
      const kvRegistry = await loadComparisonRegistryFromKv();
      if (cancelled) return;
      if (kvRegistry) {
        setRegistry((prev) => mergeCompanyRegistries(prev, kvRegistry));
      }
      // 1b. Shared cross-tenant registry (separate surface, unchanged).
      const result = await fetchSharedComparisonRegistryWithStatus();
      if (cancelled) return;
      setSharedRegistryStatus(result as SharedApiResult<CompanyRegistry>);
      if (result.data) {
        setRegistry((prev) => mergeCompanyRegistries(prev, result.data as CompanyRegistry));
      }
      setComparisonRegistryHydrated(true);
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
    // setRegistry is a stable React setter — adding it to deps would re-run
    // the hydrate effect on every parent re-render. Intentionally pinned to
    // mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Debounced localStorage write whenever the registry changes.
  useEffect(() => {
    const timer = window.setTimeout(() => persistCompanyRegistry(registry), localWriteDelayMs);
    return () => window.clearTimeout(timer);
  }, [registry, localWriteDelayMs]);

  // 3. Debounced push to shared registry once we've hydrated and have data.
  useEffect(() => {
    if (!comparisonRegistryHydrated || Object.keys(registry.companies).length === 0) return;
    const timer = window.setTimeout(() => {
      void syncSharedComparisonRegistryWithStatus(registry).then((result) =>
        setSharedRegistryStatus(result as SharedApiResult<CompanyRegistry>),
      );
    }, remoteSyncDelayMs);
    return () => window.clearTimeout(timer);
  }, [comparisonRegistryHydrated, registry, remoteSyncDelayMs]);

  // 4. Debounced write-through to the per-user KV snapshot. Gated on
  //    hydration exactly like effect 3, so a pre-hydrate empty registry
  //    can't clobber a richer cross-device snapshot. Fail-open: when no
  //    KV creds are configured kvSet writes the localStorage mirror only.
  useEffect(() => {
    if (!comparisonRegistryHydrated || Object.keys(registry.companies).length === 0) return;
    const timer = window.setTimeout(() => {
      void saveComparisonRegistryToKv(registry);
    }, remoteSyncDelayMs);
    return () => window.clearTimeout(timer);
  }, [comparisonRegistryHydrated, registry, remoteSyncDelayMs]);

  return { comparisonRegistryHydrated, sharedRegistryStatus };
}
