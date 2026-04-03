import { CompanyRegistry } from "../engine/types";
import { buildCompanyRegistrySnapshot, readCompanyRegistrySnapshot } from "./companyRegistrySnapshot";

const STORAGE_KEY = "penman.company-registry.v2";
const LEGACY_STORAGE_KEY = "penman.company-registry.v1";

function getStorage(): Storage | null {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) return null;
  return globalThis.localStorage;
}

export function readPersistedCompanyRegistry(): CompanyRegistry {
  const storage = getStorage();
  if (!storage) return { companies: {} };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) return readCompanyRegistrySnapshot(JSON.parse(raw));
  } catch {
    return { companies: {} };
  }

  try {
    const raw = storage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return { companies: {} };
    return readCompanyRegistrySnapshot(JSON.parse(raw));
  } catch {
    return { companies: {} };
  }
}

export function persistCompanyRegistry(registry: CompanyRegistry) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(buildCompanyRegistrySnapshot(registry)));
  } catch {
    // Comparison persistence should not block the main analysis flow.
  }
}
