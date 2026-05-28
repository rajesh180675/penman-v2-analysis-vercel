import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  recordSchemaMigration,
  readSchemaMigrations,
  summarizeSchemaMigrations,
  __resetSchemaMigrations,
} from "../schemaMigration";

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

describe("schemaMigration", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    __resetSchemaMigrations();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records a migration entry round-trip", () => {
    recordSchemaMigration("v8", "v9", { source: "envelope", companyId: "ITC" });
    const entries = readSchemaMigrations();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      from: "v8",
      to: "v9",
      source: "envelope",
      companyId: "ITC",
    });
    expect(entries[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("caps entries at 100 (oldest evicted)", () => {
    for (let i = 0; i < 120; i++) {
      recordSchemaMigration("v8", "v9", { source: "registry", companyId: `co-${i}` });
    }
    const entries = readSchemaMigrations();
    expect(entries).toHaveLength(100);
    // Oldest 20 evicted, so first kept entry is co-20
    expect(entries[0].companyId).toBe("co-20");
    expect(entries[99].companyId).toBe("co-119");
  });

  it("survives corrupted storage (returns empty list)", () => {
    storage.setItem("penman.schema-migrations.v1", "not-valid-json{");
    expect(readSchemaMigrations()).toEqual([]);
  });

  it("filters non-conforming entries on read", () => {
    storage.setItem(
      "penman.schema-migrations.v1",
      JSON.stringify([
        { ts: "2026-05-28T00:00:00.000Z", from: "v8", to: "v9", source: "envelope" },
        { malformed: true },
        { ts: "2026-05-28T00:00:00.000Z", from: "v9", to: "v10", source: "snapshot" },
      ]),
    );
    const entries = readSchemaMigrations();
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.to)).toEqual(["v9", "v10"]);
  });

  it("summarizes migrations by version pair and source", () => {
    recordSchemaMigration("v8", "v9", { source: "envelope" });
    recordSchemaMigration("v8", "v9", { source: "envelope" });
    recordSchemaMigration("v9", "v10", { source: "registry" });
    recordSchemaMigration("v10", "v11", { source: "snapshot" });
    const summary = summarizeSchemaMigrations();
    expect(summary.total).toBe(4);
    expect(summary.byVersion["v8->v9"]).toBe(2);
    expect(summary.byVersion["v9->v10"]).toBe(1);
    expect(summary.byVersion["v10->v11"]).toBe(1);
    expect(summary.bySource).toEqual({ envelope: 2, registry: 1, snapshot: 1 });
  });

  it("does not throw when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => recordSchemaMigration("v8", "v9", { source: "envelope" })).not.toThrow();
    expect(readSchemaMigrations()).toEqual([]);
  });
});
