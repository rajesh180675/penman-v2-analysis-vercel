/* ================================================================
   Plan 4 PR-4.3 — comparisonRegistryKv contract tests.
================================================================ */

import { describe, it, expect, beforeEach } from "vitest";
import {
  saveComparisonRegistryToKv,
  loadComparisonRegistryFromKv,
} from "../comparisonRegistryKv";
import { setAuthId } from "../identity";
import { CompanyRegistry } from "../../engine/types";

function makeRegistry(): CompanyRegistry {
  return {
    companies: {
      ITC: {
        id: "ITC",
        label: "ITC Limited",
        rawData: [],
        recastData: [],
        traceability: null,
        companyType: null,
        sector: null,
      },
    },
  };
}

beforeEach(() => {
  if (typeof localStorage !== "undefined") localStorage.clear();
  if (typeof document !== "undefined") {
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0]?.trim();
      if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
    }
  }
  setAuthId(null);
});

describe("comparisonRegistryKv (Plan 4 PR-4.3)", () => {
  it("save + load round-trip preserves the registry shape", async () => {
    const reg = makeRegistry();
    await saveComparisonRegistryToKv(reg);
    const loaded = await loadComparisonRegistryFromKv();
    expect(loaded).not.toBeNull();
    expect(Object.keys(loaded?.companies ?? {})).toEqual(["ITC"]);
  });

  it("loadComparisonRegistryFromKv returns null when nothing is stored", async () => {
    const loaded = await loadComparisonRegistryFromKv();
    expect(loaded).toBeNull();
  });

  it("anonymous and authenticated users see separate registries", async () => {
    await saveComparisonRegistryToKv({
      companies: {
        A: { id: "A", label: "A", rawData: [], recastData: [], traceability: null, companyType: null, sector: null },
      },
    });
    expect(Object.keys((await loadComparisonRegistryFromKv())?.companies ?? {})).toEqual(["A"]);

    setAuthId("user-x");
    expect(await loadComparisonRegistryFromKv()).toBeNull();
    await saveComparisonRegistryToKv({
      companies: {
        B: { id: "B", label: "B", rawData: [], recastData: [], traceability: null, companyType: null, sector: null },
      },
    });
    expect(Object.keys((await loadComparisonRegistryFromKv())?.companies ?? {})).toEqual(["B"]);

    setAuthId(null);
    expect(Object.keys((await loadComparisonRegistryFromKv())?.companies ?? {})).toEqual(["A"]);
  });
});
