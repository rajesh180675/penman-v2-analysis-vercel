import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { persistCompanyRegistry, readPersistedCompanyRegistry } from "../companyRegistryStore";
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
            schemaVersion: "2026-04-traceability-v8",
            generatedAt: "2026-04-03T10:00:00.000Z",
          } as never,
        },
      },
    };

    persistCompanyRegistry(registry);
    const restored = readPersistedCompanyRegistry();

    expect(restored.companies.ITC).toBeTruthy();
    expect(restored.companies.ITC?.recastData).toHaveLength(1);
    expect(restored.companies.ITC?.traceability).toBeTruthy();
  });

  it("fails closed on malformed persisted payloads", () => {
    storage.setItem("penman.company-registry.v1", "{not-json");
    expect(readPersistedCompanyRegistry()).toEqual({ companies: {} });

    storage.setItem("penman.company-registry.v1", JSON.stringify({
      companies: {
        broken: {
          label: "Broken only",
        },
      },
    }));
    expect(readPersistedCompanyRegistry()).toEqual({ companies: {} });
  });
});
