import { CompanyRegistry, MultiCompanyRecord } from "../engine/types";

const STORAGE_KEY = "penman.company-registry.v1";

function getStorage(): Storage | null {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) return null;
  return globalThis.localStorage;
}

function sanitizeCompanyRecord(value: unknown): MultiCompanyRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<MultiCompanyRecord>;
  if (typeof record.id !== "string" || !record.id) return null;
  return {
    id: record.id,
    label: typeof record.label === "string" && record.label ? record.label : record.id,
    rawData: Array.isArray(record.rawData) ? record.rawData : [],
    recastData: Array.isArray(record.recastData) ? record.recastData : [],
    traceability: record.traceability ?? null,
  };
}

export function readPersistedCompanyRegistry(): CompanyRegistry {
  const storage = getStorage();
  if (!storage) return { companies: {} };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { companies: {} };
    const parsed = JSON.parse(raw) as { companies?: Record<string, unknown> } | null;
    const companies = Object.entries(parsed?.companies ?? {}).reduce<Record<string, MultiCompanyRecord>>((acc, [companyId, value]) => {
      const record = sanitizeCompanyRecord(value);
      if (!record) return acc;
      acc[companyId] = record.id === companyId ? record : { ...record, id: companyId };
      return acc;
    }, {});
    return { companies };
  } catch {
    return { companies: {} };
  }
}

export function persistCompanyRegistry(registry: CompanyRegistry) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(registry));
  } catch {
    // Comparison persistence should not block the main analysis flow.
  }
}
