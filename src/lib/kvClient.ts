/* ================================================================
   Browser-local persistence adapter.

   Storage credentials must never be compiled into a Vite bundle. Remote
   persistence belongs behind an authenticated same-origin server API; until
   that repository is available this compatibility adapter is deliberately
   localStorage-only. Callers retain the existing async result contract so the
   server-backed implementation can be introduced without another UI rewrite.
================================================================ */

const PREFIX = "penman.kv.";

export type KvSource = "kv" | "localStorage" | "none";

export interface KvResult<T> {
  source: KvSource;
  value: T | null;
  error?: string | undefined;
}

function localKey(key: string): string {
  return `${PREFIX}${key}`;
}

function readLocal<T>(key: string): T | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(localKey(key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLocal<T>(key: string, value: T): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(localKey(key), JSON.stringify(value));
  } catch {
    /* quota exceeded — skip */
  }
}

function deleteLocal(key: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(localKey(key));
  } catch {
    /* skip */
  }
}

export function isKvEnabled(): boolean {
  return false;
}

/**
 * Read a value from the browser-local compatibility store.
 */
export async function kvGet<T>(key: string): Promise<KvResult<T>> {
  const local = readLocal<T>(key);
  return { source: local != null ? "localStorage" : "none", value: local };
}

/**
 * Write a value to the browser-local compatibility store.
 *
 * @param ttlSeconds optional TTL. Anonymous users (cookie-pinned UUIDs)
 *   get 30-day TTL; authenticated keys never TTL.
 */
export async function kvSet<T>(key: string, value: T, ttlSeconds?: number): Promise<KvResult<T>> {
  void ttlSeconds;
  writeLocal(key, value);
  return { source: "localStorage", value };
}

export async function kvDelete(key: string): Promise<KvResult<null>> {
  deleteLocal(key);
  return { source: "localStorage", value: null };
}
