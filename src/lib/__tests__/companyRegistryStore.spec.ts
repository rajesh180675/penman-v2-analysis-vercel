import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { persistCompanyRegistry, readPersistedCompanyRegistry } from "../companyRegistryStore";
import { buildCompanyRegistrySnapshot, mergeCompanyRegistries, readCompanyRegistrySnapshot } from "../companyRegistrySnapshot";
import { CompanyRegistry } from "../../engine/types";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key) ?? null : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe("companyRegistryStore", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips persisted comparison companies across reloads", () => {
    const registry: CompanyRegistry = {
      companies: {
        ITC: {
          id: "ITC",
          label: "ITC",
          rawData: [{ company_id: "ITC", period_end: "2025-03-31", raw_metric_values: { Revenue: 1 } }],
          recastData: [{ period_end: "2025-03-31", bs: {} as never, is: {} as never, cu: {} as never, cf: {} as never }],
          traceability: {
            schemaVersion: "2026-06-traceability-v10",
            generatedAt: "2026-04-03T10:00:00.000Z",
            runContext: {},
            policyVersions: {},
            confidence: {},
            rigor: {},
          } as never,
        },
      },
    };

    persistCompanyRegistry(registry);
    const restored = readPersistedCompanyRegistry();

    expect(storage.getItem("penman.company-registry.v2")).toContain("2026-04-comparison-registry-v1");
    expect(restored.companies.ITC).toBeTruthy();
    expect(restored.companies.ITC?.recastData).toHaveLength(1);
    expect(restored.companies.ITC?.traceability).toBeTruthy();
  });

  it("falls back to the legacy local-storage key", () => {
    storage.setItem("penman.company-registry.v1", JSON.stringify({
      companies: {
        HUL: {
          id: "HUL",
          label: "HUL",
          rawData: [],
          recastData: [],
          traceability: null,
        },
      },
    }));

    const restored = readPersistedCompanyRegistry();

    expect(restored.companies.HUL?.label).toBe("HUL");
  });

  it("fails closed on malformed persisted payloads", () => {
    storage.setItem("penman.company-registry.v2", "{not-json");
    expect(readPersistedCompanyRegistry()).toEqual({ companies: {} });

    storage.setItem("penman.company-registry.v2", JSON.stringify({
      companies: {
        broken: {
          label: "Broken only",
        },
      },
    }));
    expect(readPersistedCompanyRegistry()).toEqual({ companies: {} });
  });

  it("drops traceability payloads that do not match the current envelope schema (v9 stale)", () => {
    storage.setItem("penman.company-registry.v2", JSON.stringify(buildCompanyRegistrySnapshot({
      companies: {
        ITC: {
          id: "ITC",
          label: "ITC",
          rawData: [],
          recastData: [],
          traceability: {
            schemaVersion: "2026-06-traceability-v9",
            generatedAt: "2026-04-03T10:00:00.000Z",
          } as never,
        },
      },
    })));

    const restored = readPersistedCompanyRegistry();

    expect(restored.companies.ITC?.traceability).toBeNull();
  });

  it("merges shared registry records without discarding richer local peer state", () => {
    const merged = mergeCompanyRegistries(
      {
        companies: {
          ITC: {
            id: "ITC",
            label: "ITC Local",
            rawData: [{ company_id: "ITC", period_end: "2025-03-31", raw_metric_values: { Revenue: 1 } }],
            recastData: [],
            traceability: null,
          },
        },
      },
      readCompanyRegistrySnapshot(buildCompanyRegistrySnapshot({
        companies: {
          ITC: {
            id: "ITC",
            label: "ITC Shared",
            rawData: [{ company_id: "ITC", period_end: "2025-03-31", raw_metric_values: { Revenue: 1 } }],
            recastData: [{ period_end: "2025-03-31", bs: {} as never, is: {} as never, cu: {} as never, cf: {} as never }],
            traceability: {
              schemaVersion: "2026-06-traceability-v10",
              generatedAt: "2026-04-03T10:00:00.000Z",
              runContext: {},
              policyVersions: {},
              confidence: {},
              rigor: {},
            } as never,
          },
        },
      })),
    );

    expect(merged.companies.ITC?.label).toBe("ITC Shared");
    expect(merged.companies.ITC?.recastData).toHaveLength(1);
    expect(merged.companies.ITC?.traceability?.schemaVersion).toBe("2026-06-traceability-v10");
  });
});
