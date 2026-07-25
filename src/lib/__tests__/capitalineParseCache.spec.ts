import { describe, it, expect, beforeEach } from "vitest";
import {
  readCachedParse,
  writeCachedParse,
  sha256Hex,
  PARSE_CACHE_VERSION,
} from "@/lib/capitalineParseCache";

// Minimal fake indexedDB for node test environment
class FakeIDBRequest<T = unknown> {
  result: T | undefined;
  error: Error | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  oncomplete: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}
class FakeIDBStore {
  data = new Map<string, unknown>();
  put(v: unknown & { zipSha256: string }) { this.data.set(v.zipSha256, v); const r = new FakeIDBRequest(); queueMicrotask(() => r.onsuccess?.()); return r; }
  get(k: string) { const r = new FakeIDBRequest(); r.result = this.data.get(k); queueMicrotask(() => r.onsuccess?.()); return r; }
  getAllKeys() { const r = new FakeIDBRequest<IDBValidKey[]>(); r.result = [...this.data.keys()]; queueMicrotask(() => r.onsuccess?.()); return r; }
  delete(k: string) { this.data.delete(k); const r = new FakeIDBRequest(); queueMicrotask(() => r.onsuccess?.()); return r; }
}
class FakeIDBTx {
  constructor(private store: FakeIDBStore) { }
  objectStore() { return this.store; }
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor_(name: string) { void name; }
}
class FakeIDB {
  store = new FakeIDBStore();
  objectStoreNames = { contains: () => true };
  transaction() {
    const tx = new FakeIDBTx(this.store);
    queueMicrotask(() => tx.oncomplete?.());
    return tx;
  }
  close() { }
}
const fakeDb = new FakeIDB();
(globalThis as unknown as { indexedDB: unknown }).indexedDB = {
  open: () => {
    const r = new FakeIDBRequest<IDBDatabase>();
    r.result = fakeDb as unknown as IDBDatabase;
    queueMicrotask(() => r.onsuccess?.());
    return r;
  },
};

/** A minimal valid entry, without the parserVersion that writeCachedParse stamps. */
function baseEntry(sha: string) {
  return {
    zipSha256: sha,
    zipSize: 1,
    cachedAt: new Date().toISOString(),
    periods: [{ company_id: "T", period_end: "2024-03-31", raw_metric_values: { x: 1 } }],
    debug: {
      files: [], rawMetricKeys: [], warnings: [], sample: {}, sourceArtifactHashes: [],
      rawGrids: [], statementCoverage: {}, keyCollisionReport: {},
    } as unknown as import("@/engine/capitalineParser").CapitalineParseDebug,
    segmentData: null,
  };
}

describe("capitalineParseCache", () => {
  beforeEach(() => { fakeDb.store.data.clear(); });

  it("sha256Hex produces stable hash", async () => {
    const bytes = new TextEncoder().encode("hello world");
    const a = await sha256Hex(bytes);
    const b = await sha256Hex(bytes);
    expect(a).toBeTruthy();
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("write → read round-trip", async () => {
    const bytes = new TextEncoder().encode("test-zip");
    const sha = await sha256Hex(bytes);
    expect(sha).toBeTruthy();
    const entry = {
      zipSha256: sha!,
      zipSize: bytes.length,
      cachedAt: new Date().toISOString(),
      periods: [{ company_id: "T", period_end: "2024-03-31", raw_metric_values: { x: 1 } }],
      debug: { files: [], rawMetricKeys: [], warnings: [], sample: {}, sourceArtifactHashes: [], rawGrids: [], statementCoverage: {}, keyCollisionReport: {} } as unknown as import("@/engine/capitalineParser").CapitalineParseDebug,
      segmentData: null,
    };
    await writeCachedParse(entry);
    const got = await readCachedParse(sha!);
    expect(got).not.toBeNull();
    expect(got?.periods).toHaveLength(1);
    expect(got?.zipSha256).toBe(sha);
  });

  it("returns null for unknown key", async () => {
    const got = await readCachedParse("does-not-exist");
    expect(got).toBeNull();
  });

  it("stamps the current parser version on write", async () => {
    const sha = (await sha256Hex(new TextEncoder().encode("stamped")))!;
    await writeCachedParse({ ...baseEntry(sha), zipSize: 7 });
    expect((await readCachedParse(sha))?.parserVersion).toBe(PARSE_CACHE_VERSION);
  });

  it("treats an entry written by a different parser build as a miss", async () => {
    // The ZIP bytes are unchanged, so the key is identical — content-addressing
    // alone cannot invalidate this. Without the version check a parser fix
    // would never reach anyone who had already loaded the company once, which
    // is exactly how a stale bad parse survives a source-level fix.
    const sha = (await sha256Hex(new TextEncoder().encode("stale-parser")))!;
    fakeDb.store.data.set(sha, {
      ...baseEntry(sha),
      zipSize: 12,
      parserVersion: "2025-01-some-older-parser",
    });

    expect(await readCachedParse(sha)).toBeNull();

    // Re-parsing and re-writing under the current version makes it readable.
    await writeCachedParse({ ...baseEntry(sha), zipSize: 12 });
    expect(await readCachedParse(sha)).not.toBeNull();
  });
});
