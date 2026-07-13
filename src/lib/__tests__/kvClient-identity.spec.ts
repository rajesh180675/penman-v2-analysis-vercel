/* ================================================================
   Plan 4 PR-4.1 — kvClient + identity contract tests.
================================================================ */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { isKvEnabled, kvGet, kvSet, kvDelete } from "../kvClient";
import {
  getAnonId,
  setAuthId,
  getAuthId,
  getCurrentUserId,
  isAuthenticated,
  ttlForCurrentUser,
  userScopedKey,
} from "../identity";

beforeEach(() => {
  if (typeof localStorage !== "undefined") localStorage.clear();
  if (typeof document !== "undefined") {
    // wipe all penman cookies
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0]?.trim();
      if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
    }
  }
});

describe("kvClient (Plan 4 PR-4.1)", () => {
  it("keeps remote KV disabled in browser code", () => {
    expect(isKvEnabled()).toBe(false);
  });

  it("never sends storage credentials or values over fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await kvSet("sensitive", { value: 42 });
    await kvGet("sensitive");
    await kvDelete("sensitive");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("kvSet writes to localStorage when KV disabled, source='localStorage'", async () => {
    const r = await kvSet("greeting", { msg: "hello" });
    expect(r.source).toBe("localStorage");
    expect(r.value).toEqual({ msg: "hello" });
  });

  it("kvGet returns localStorage value when KV disabled", async () => {
    await kvSet("greeting", { msg: "hello" });
    const r = await kvGet<{ msg: string }>("greeting");
    expect(r.source).toBe("localStorage");
    expect(r.value).toEqual({ msg: "hello" });
  });

  it("kvGet returns null+source='none' when key absent", async () => {
    const r = await kvGet("nonexistent");
    expect(r.value).toBeNull();
    expect(r.source).toBe("none");
  });

  it("kvDelete removes the value", async () => {
    await kvSet("greeting", { msg: "hello" });
    await kvDelete("greeting");
    const r = await kvGet("greeting");
    expect(r.value).toBeNull();
  });
});

describe("identity (Plan 4 PR-4.1)", () => {
  it("getAnonId() generates a UUID-shaped string", () => {
    const id = getAnonId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("getAnonId() is stable across calls", () => {
    const a = getAnonId();
    const b = getAnonId();
    expect(a).toBe(b);
  });

  it("setAuthId / getAuthId round-trip", () => {
    setAuthId("user-123");
    expect(getAuthId()).toBe("user-123");
    setAuthId(null);
    expect(getAuthId()).toBeNull();
  });

  it("getCurrentUserId prefers auth over anon", () => {
    const anon = getAnonId();
    expect(getCurrentUserId()).toBe(anon);
    setAuthId("user-456");
    expect(getCurrentUserId()).toBe("user-456");
  });

  it("isAuthenticated reflects auth state", () => {
    expect(isAuthenticated()).toBe(false);
    setAuthId("user-789");
    expect(isAuthenticated()).toBe(true);
  });

  it("ttlForCurrentUser: anon = 30 days, auth = undefined", () => {
    expect(ttlForCurrentUser()).toBe(30 * 86400);
    setAuthId("user-x");
    expect(ttlForCurrentUser()).toBeUndefined();
  });

  it("userScopedKey namespaces under anon vs auth prefix", () => {
    const anonKey = userScopedKey("workspace");
    expect(anonKey.startsWith("u:anon:")).toBe(true);
    expect(anonKey.endsWith(":workspace")).toBe(true);
    setAuthId("user-x");
    const authKey = userScopedKey("workspace");
    expect(authKey).toBe("u:auth:user-x:workspace");
  });
});
