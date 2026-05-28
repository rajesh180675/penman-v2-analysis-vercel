/* ================================================================
   Plan 4 PR-4.1 — kvClient.ts

   Fail-open Vercel KV (Upstash) wrapper. Calls go through Vercel KV
   REST when both env vars are present; on any error (including
   missing creds) we fall through to localStorage. Callers always
   get a result; they can inspect the `source` field to see whether
   it came from KV or local.

   Why fetch + REST instead of @vercel/kv:
     - Keeps the bundle lean and deterministic (no SDK pinning).
     - Works in any browser context (the SDK assumes server-side).
     - The REST API surface we need is a pencil-thin GET / SET / DEL.
================================================================ */

const PREFIX = "penman.kv.";

interface KvCreds { url: string; bearer: string }

function readKvCreds(): KvCreds | null {
  let url: string | undefined;
  let bearer: string | undefined;
  try {
    const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    if (meta) {
      url = meta.VITE_KV_REST_API_URL ?? meta.KV_REST_API_URL;
      bearer = meta.VITE_KV_REST_API_TOKEN ?? meta.KV_REST_API_TOKEN;
    }
  } catch {
    /* import.meta not supported in this build target */
  }
  if ((!url || !bearer) && typeof process !== "undefined" && process.env) {
    url = url ?? process.env.KV_REST_API_URL;
    bearer = bearer ?? process.env.KV_REST_API_TOKEN;
  }
  if (!url || !bearer) return null;
  return { url, bearer };
}

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
  return readKvCreds() != null;
}

/**
 * Read a value. Tries KV first; on any failure (no creds, network
 * error, KV miss) returns the localStorage fallback (or null).
 */
export async function kvGet<T>(key: string): Promise<KvResult<T>> {
  const creds = readKvCreds();
  if (!creds) {
    const local = readLocal<T>(key);
    return { source: local != null ? "localStorage" : "none", value: local };
  }

  try {
    const res = await fetch(`${creds.url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${creds.bearer}` },
      method: "GET",
    });
    if (!res.ok) throw new Error(`KV GET ${key}: HTTP ${res.status}`);
    const body = (await res.json()) as { result: string | null };
    if (body.result == null) {
      const local = readLocal<T>(key);
      return { source: local != null ? "localStorage" : "none", value: local };
    }
    const parsed = JSON.parse(body.result) as T;
    writeLocal(key, parsed);
    return { source: "kv", value: parsed };
  } catch (err) {
    const local = readLocal<T>(key);
    return {
      source: local != null ? "localStorage" : "none",
      value: local,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Write a value. Always writes to localStorage immediately so the
 * UI sees its own write back. Best-effort write to KV.
 *
 * @param ttlSeconds optional TTL. Anonymous users (cookie-pinned UUIDs)
 *   get 30-day TTL; authenticated keys never TTL.
 */
export async function kvSet<T>(key: string, value: T, ttlSeconds?: number): Promise<KvResult<T>> {
  writeLocal(key, value);
  const creds = readKvCreds();
  if (!creds) return { source: "localStorage", value };
  try {
    const url = ttlSeconds
      ? `${creds.url}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`
      : `${creds.url}/set/${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
    });
    if (!res.ok) throw new Error(`KV SET ${key}: HTTP ${res.status}`);
    return { source: "kv", value };
  } catch (err) {
    return {
      source: "localStorage",
      value,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function kvDelete(key: string): Promise<KvResult<null>> {
  deleteLocal(key);
  const creds = readKvCreds();
  if (!creds) return { source: "localStorage", value: null };
  try {
    const res = await fetch(`${creds.url}/del/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.bearer}` },
    });
    if (!res.ok) throw new Error(`KV DEL ${key}: HTTP ${res.status}`);
    return { source: "kv", value: null };
  } catch (err) {
    return {
      source: "localStorage",
      value: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
