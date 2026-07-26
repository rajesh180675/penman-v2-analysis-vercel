/* ================================================================
   P5 — the audit's display-name -> catalog-model-id maps must resolve.

   `independenceGroupsForModelIds` throws on an unknown id, which is the right
   behaviour at runtime (silently dropping an entry would quietly lower an
   independence count that gates release claims). But a typo would then only
   surface during a real audit of a company that happens to compute that model —
   `EV` maps to the insurance embedded-value model, which no bank fixture
   computes, so a bad id there could sit undetected for a long time.

   These tests need no fixtures and no pipeline run, so they live in their own
   file rather than in auditCompanyRun.spec.ts, which costs ~4 minutes.
================================================================ */

import { describe, expect, it } from "vitest";
import { FI_AUDIT_MODEL_IDS, INDUSTRIAL_AUDIT_MODEL_IDS } from "../lib/auditCompanyRun";
import { CURRENT_MODEL_REGISTRY, independenceGroupsForModelIds } from "../../src/engine/modelCatalog";

const ALL_MAPS = [
  ["FI_AUDIT_MODEL_IDS", FI_AUDIT_MODEL_IDS] as const,
  ["INDUSTRIAL_AUDIT_MODEL_IDS", INDUSTRIAL_AUDIT_MODEL_IDS] as const,
];

describe("audit model-id maps", () => {
  for (const [mapName, map] of ALL_MAPS) {
    it(`${mapName}: every model id exists in the catalog`, () => {
      const missing = Object.entries(map)
        .filter(([, modelId]) => !CURRENT_MODEL_REGISTRY.has(modelId))
        .map(([displayName, modelId]) => `${displayName} -> ${modelId}`);

      expect(missing).toEqual([]);
    });

    it(`${mapName}: grouping every mapped model does not throw`, () => {
      expect(() => independenceGroupsForModelIds(Object.values(map), CURRENT_MODEL_REGISTRY)).not.toThrow();
    });

    it(`${mapName}: display names map to distinct models`, () => {
      // Two audit names pointing at one model id would mean the audit reports a
      // model twice under different labels.
      const ids = Object.values(map);
      expect(new Set(ids).size).toBe(ids.length);
    });
  }

  it("FI_AUDIT_MODEL_IDS covers exactly the six bank model display names", () => {
    // Pinned against computedBankModelNames: a new bank model added there
    // without a mapping here would silently stop contributing to the
    // independence count.
    expect(Object.keys(FI_AUDIT_MODEL_IDS).sort()).toEqual([
      "DDM",
      "ERI",
      "EV",
      "P/AUM",
      "PB",
      "ROA×LevRI",
    ]);
  });

  it("INDUSTRIAL_AUDIT_MODEL_IDS covers exactly the five industrial model display names", () => {
    // Pinned against computedIndustrialModelNames.
    expect(Object.keys(INDUSTRIAL_AUDIT_MODEL_IDS).sort()).toEqual([
      "CASH_DCF",
      "EPV",
      "EV/EBITDA",
      "SOTP",
      "VCC",
    ]);
  });
});
