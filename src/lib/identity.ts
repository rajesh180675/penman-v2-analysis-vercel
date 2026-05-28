/* ================================================================
   Plan 4 PR-4.1 — identity.ts

   Lightweight identity layer: cookie-pinned anonymous UUID with
   30-day TTL. When the user is authenticated (set via setAuthId),
   that id wins and never expires.

   Browser-only — server contexts get a no-op. SSR never actually
   needs identity since persistence is per-tab.
================================================================ */

const ANON_COOKIE_NAME = "penman_anon_id";
const AUTH_LOCAL_KEY = "penman.user.auth.v1";
const ANON_TTL_DAYS = 30;
const KV_AUTH_PREFIX = "u:auth:";
const KV_ANON_PREFIX = "u:anon:";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const target = `${name}=`;
  for (const cookie of document.cookie.split(";")) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(target)) return trimmed.slice(target.length);
  }
  return null;
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === "undefined") return;
  const isSecure = typeof location !== "undefined" && location.protocol === "https:";
  const attrs = [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "SameSite=Lax",
    isSecure ? "Secure" : "",
  ].filter(Boolean).join("; ");
  document.cookie = attrs;
}

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Returns the anonymous UUID, generating + persisting one if absent. */
export function getAnonId(): string {
  const existing = readCookie(ANON_COOKIE_NAME);
  if (existing && existing.length > 0) return existing;
  const fresh = generateUuid();
  writeCookie(ANON_COOKIE_NAME, fresh, ANON_TTL_DAYS * 86_400);
  return fresh;
}

export function setAuthId(id: string | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (id == null) localStorage.removeItem(AUTH_LOCAL_KEY);
    else localStorage.setItem(AUTH_LOCAL_KEY, id);
  } catch {
    /* skip */
  }
}

export function getAuthId(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(AUTH_LOCAL_KEY);
  } catch {
    return null;
  }
}

/** Active user id. Authenticated wins over anonymous. */
export function getCurrentUserId(): string {
  return getAuthId() ?? getAnonId();
}

export function isAuthenticated(): boolean {
  return getAuthId() != null;
}

/** Anonymous: 30 days. Authenticated: undefined (never expires). */
export function ttlForCurrentUser(): number | undefined {
  return isAuthenticated() ? undefined : ANON_TTL_DAYS * 86_400;
}

/** KV key namespaced under the current user. */
export function userScopedKey(key: string): string {
  const id = getCurrentUserId();
  const prefix = isAuthenticated() ? KV_AUTH_PREFIX : KV_ANON_PREFIX;
  return `${prefix}${id}:${key}`;
}
