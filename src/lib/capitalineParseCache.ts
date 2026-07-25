/* ================================================================
   capitalineParseCache — IndexedDB cache for parsed Capitaline periods.

   Keyed by SHA-256 of the ZIP's uncompressed bytes. Loading TCS (33 MB
   uncompressed HTML across 6 files) takes ~14s to parse; caching the
   RawPeriodData[] drops the second load to <100 ms.

   Cache is content-addressed on the ZIP bytes AND stamped with the parser
   version. Content-addressing alone is not enough: the key only changes when
   the *input* changes, so a parser fix would keep serving output produced by
   the old parser until the entry aged out. Reads reject a version mismatch.
   Bump PARSE_CACHE_VERSION whenever a change to the parser can alter the
   periods/debug/segment payload for unchanged input.
================================================================ */

import type { RawPeriodData } from "../engine/types";
import type { CapitalineParseDebug } from "../engine/capitalineParser";
import type { AllSegmentData } from "../engine/segmentParser";

const DB_NAME = "penman-capitaline-parse-cache";
/** Bumped to 2 to drop entries written before parser-version stamping existed. */
const DB_VERSION = 2;
const STORE = "parsedZips";
/** Identifies the parser build whose output an entry holds. */
export const PARSE_CACHE_VERSION = "2026-07-grid-streaming-v2";
const MAX_ENTRIES = 20;
const MAX_VALUE_BYTES = 24 * 1024 * 1024; // 24 MB safety cap per entry

export interface CachedParseResult {
  periods: RawPeriodData[];
  debug: CapitalineParseDebug;
  segmentData: AllSegmentData | null;
  cachedAt: string;
  zipSha256: string;
  zipSize: number;
  /** Stamped by writeCachedParse — callers do not supply it. */
  parserVersion: string;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Recreate rather than reuse: entries written before parserVersion
      // existed would otherwise linger, unreadable, until LRU eviction —
      // occupying quota for parses that can never be served again.
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE, { keyPath: "zipSha256" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

/** SHA-256 of an ArrayBuffer, hex-encoded. Returns null when crypto.subtle is unavailable. */
export async function sha256Hex(buffer: ArrayBuffer | Uint8Array): Promise<string | null> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    const buf: ArrayBuffer = buffer instanceof Uint8Array
      ? (buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
      : buffer;
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

export async function readCachedParse(zipSha256: string): Promise<CachedParseResult | null> {
  if (!hasIndexedDb()) return null;
  try {
    const db = await openDb();
    try {
      return await new Promise<CachedParseResult | null>((resolve) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(zipSha256);
        req.onsuccess = () => {
          const hit = (req.result as CachedParseResult | undefined) ?? null;
          // A hit written by a different parser build is a miss: the ZIP bytes
          // are unchanged, but the parse output may not be. Re-parsing is the
          // only safe answer, otherwise a parser fix never reaches a user who
          // already loaded the company once.
          if (hit && hit.parserVersion !== PARSE_CACHE_VERSION) {
            resolve(null);
            return;
          }
          resolve(hit);
        };
        req.onerror = () => resolve(null);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** Stamps the current parser version, so callers cannot forget to. */
export async function writeCachedParse(
  input: Omit<CachedParseResult, "parserVersion">,
): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const entry: CachedParseResult = { ...input, parserVersion: PARSE_CACHE_VERSION };
    // Skip caching payloads that would exceed the safety cap.
    const approxBytes = JSON.stringify(entry).length;
    if (approxBytes > MAX_VALUE_BYTES) return;

    const db = await openDb();
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      await evictIfNeeded(db);
    } finally {
      db.close();
    }
  } catch {
    // Cache failures are non-fatal — parsing continues uncached.
  }
}

async function evictIfNeeded(db: IDBDatabase): Promise<void> {
  try {
    const keys = await new Promise<string[]>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => resolve([]);
    });
    if (keys.length <= MAX_ENTRIES) return;
    // Evict oldest by cachedAt.
    const entries = await Promise.all(
      keys.map(async (k) => {
        const v = await readCachedParse(k);
        return { key: k, cachedAt: v?.cachedAt ?? "" };
      }),
    );
    entries.sort((a, b) => a.cachedAt.localeCompare(b.cachedAt));
    const toDelete = entries.slice(0, entries.length - MAX_ENTRIES);
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      for (const e of toDelete) tx.objectStore(STORE).delete(e.key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Eviction failures are non-fatal.
  }
}
