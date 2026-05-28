/* ================================================================
   Plan 2 PR-2.1 — useRegistryPersistence

   Bundles the three registry-side effects from App.tsx:
     1. Debounce the localStorage write (250ms coalesce window).
     2. Hydrate from the shared comparison registry on mount.
     3. Push to the shared registry after the user pauses (600ms).

   The hook owns its own timers; consumers just pass the registry
   state and a setter. Observable behaviour is identical to the
   App.tsx originals.
================================================================ */

import { useEffect, useState } from "react";
import {
  fetchSharedComparisonRegistryWithStatus,
  syncSharedComparisonRegistryWithStatus,
} from "../lib/sharedResearchApi";
import {
  persistCompanyRegistry,
} from "../lib/companyRegistryStore";
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

  // 1. Hydrate from shared registry on mount.
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
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

  return { comparisonRegistryHydrated, sharedRegistryStatus };
}
