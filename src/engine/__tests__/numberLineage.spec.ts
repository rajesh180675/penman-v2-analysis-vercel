import { describe, expect, it } from "vitest";
import { buildLineageMap, buildLineageRef } from "../lineageBuilder";
import {
  LINEAGE_CONCEPT_IDS,
  LINEAGE_POLICY_DECISIONS_CAP,
  LINEAGE_SOURCE_KEYS_CAP,
  LINEAGE_TRANSFORMATION_STEPS_CAP,
} from "../lineageTypes";
import { RawPeriodData, RecastPeriod } from "../types";

function mkRecast(period_end: string, overrides: Partial<{
  noa: number; nfo: number; cse: number; coreOI: number; rnoa: number; pat: number; cfo: number; capex: number;
  specFlags: { label: string; affects_terminal: boolean; severity: string; message?: string }[];
}> = {}): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1500, CSE: overrides.cse ?? 1000, MI: 0, FA: 100, FO: 200, OA: 1300, OL: 200,
      OL_TradePayables: 50, OL_OtherCurrentLiabilities: 50, OL_ProvisionsCurrent: 20,
      OL_ProvisionsLongTerm: 20, OL_CurrentTaxLiabilities: 20, OL_NonCurrentTaxLiabilities: 20,
      OL_DeferredTaxLiabilitiesNet: 10, OL_OtherNonCurrentLiabilities: 10,
      NOA: overrides.noa ?? 1100, NFO: overrides.nfo ?? 100, DTL: 10, PensionObl: 0, OL_ex_DTL: 190,
      Goodwill: 0, CurrentAssets: 400, CurrentLiabilities: 200,
      Inventory: 100, TradeReceivables: 100, TradePayables: 50, PPE: 700, LIFO_reserve: 0,
      separationScore: 90, OA_PPE: 700, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
      OA_Inventory: 100, OA_TradeReceivables: 100, OA_DTA: 0, OA_CWIP: 0, OA_Other: 400,
    } as never,
    is: {
      Sales: 1000, TaxExpense: 30, taxRate: 0.25, PAT: overrides.pat ?? 100,
      OCI: 0, TCI: 100, TCI_NCI: 0, CNI: 100,
      FinanceCost: 10, FinanceIncome: 2, FinanceIncomeRung: 1, PreferredDividend: 0,
      NFE: 7, OI: 110, OtherItems: 0, OI_from_sales: 110, MII: 0, COGS: 600,
    } as never,
    cu: {
      UOI: 0, CoreOI: overrides.coreOI ?? 110, UFE: 0, CoreNFE: 7,
      ExceptionalItemsAfterTax: 0, OCITotal: 0,
    } as never,
    cf: {
      CFO: overrides.cfo ?? 90, Capex: overrides.capex ?? -40,
      DividendPaid: -10, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 1, DividendReceived: 0,
      FCF_accounting: 50, FCF_cash: 50,
      d_t: 0, d_t_formula: 0, d_t_discrepancy: 0, EBITDA: 150,
    } as never,
    ratios: { RNOA: overrides.rnoa ?? 0.10 } as never,
    spec_flags: overrides.specFlags as never ?? [],
  };
}

function mkRaw(period_end: string): RawPeriodData {
  return {
    company_id: "TEST", period_end,
    raw_metric_values: {
      "Total Equity__BalanceSheet": 1000,
      "Profit After Tax__ProfitLoss": 100,
      "Net Cash From Operating Activities__CashFlow": 90,
    },
  };
}

describe("lineageBuilder", () => {
  it("emits one lineage entry per (concept, period) for the 8 instrumented concepts", () => {
    const recast = [mkRecast("2024-03-31"), mkRecast("2025-03-31")];
    const raw = recast.map((r) => mkRaw(r.period_end));
    const map = buildLineageMap({ recastData: recast, rawData: raw });
    expect(Object.keys(map.entries)).toHaveLength(LINEAGE_CONCEPT_IDS.length * 2);
    for (const id of LINEAGE_CONCEPT_IDS) {
      expect(map.entries[`${id}|2024-03-31`]).toBeDefined();
      expect(map.entries[`${id}|2025-03-31`]).toBeDefined();
    }
  });

  it("populates sourceMetricKeys with raw keys for concepts that map to raw labels", () => {
    const recast = [mkRecast("2025-03-31")];
    const raw = [mkRaw("2025-03-31")];
    const map = buildLineageMap({ recastData: recast, rawData: raw });
    const cseEntry = map.entries["cse|2025-03-31"]!;
    expect(cseEntry.sourceMetricKeys.some((k) => k.includes("Equity"))).toBe(true);
  });

  it("includes derived source keys for derived concepts", () => {
    const recast = [mkRecast("2025-03-31")];
    const map = buildLineageMap({ recastData: recast, rawData: [] });
    const noaEntry = map.entries["noa|2025-03-31"]!;
    expect(noaEntry.sourceMetricKeys).toContain("BS.TA");
    expect(noaEntry.sourceStatements).toEqual(["BS"]);
  });

  it("propagates spec_flags into policyDecisionsApplied", () => {
    const recast = [mkRecast("2025-03-31", {
      specFlags: [
        { label: "CAPITAL_TRANSACTION", affects_terminal: true, severity: "warning", message: "Buyback detected." },
      ],
    })];
    const map = buildLineageMap({ recastData: recast, rawData: [] });
    const rnoaEntry = map.entries["rnoa|2025-03-31"]!;
    expect(rnoaEntry.policyDecisionsApplied).toContain("spec_flag: CAPITAL_TRANSACTION");
    expect(rnoaEntry.confidence).toBe("medium");
    expect(rnoaEntry.warnings.length).toBeGreaterThan(0);
  });

  it("caps policyDecisionsApplied at LINEAGE_POLICY_DECISIONS_CAP", () => {
    const flags = Array.from({ length: 30 }, (_, i) => ({
      label: `FLAG_${i}`, affects_terminal: false, severity: "info" as never,
    }));
    const recast = [mkRecast("2025-03-31", { specFlags: flags as never })];
    const map = buildLineageMap({ recastData: recast, rawData: [] });
    const noa = map.entries["noa|2025-03-31"]!;
    expect(noa.policyDecisionsApplied.length).toBeLessThanOrEqual(LINEAGE_POLICY_DECISIONS_CAP + 1);
    expect(noa.policyDecisionsApplied[noa.policyDecisionsApplied.length - 1]).toMatch(/more/);
  });

  it("transformation steps stay under LINEAGE_TRANSFORMATION_STEPS_CAP", () => {
    const recast = [mkRecast("2025-03-31")];
    const map = buildLineageMap({ recastData: recast, rawData: [] });
    for (const entry of Object.values(map.entries)) {
      expect(entry.transformationSteps.length).toBeLessThanOrEqual(LINEAGE_TRANSFORMATION_STEPS_CAP);
    }
  });

  it("source keys stay under LINEAGE_SOURCE_KEYS_CAP", () => {
    const recast = [mkRecast("2025-03-31")];
    const map = buildLineageMap({ recastData: recast, rawData: [] });
    for (const entry of Object.values(map.entries)) {
      expect(entry.sourceMetricKeys.length).toBeLessThanOrEqual(LINEAGE_SOURCE_KEYS_CAP);
    }
  });

  it("populates IV/share lineage when caller provides it", () => {
    const recast = [mkRecast("2025-03-31")];
    const map = buildLineageMap({
      recastData: recast,
      rawData: [],
      intrinsicValuePerShareByPeriod: { "2025-03-31": 1234.56 },
    });
    const iv = map.entries["intrinsic-value-per-share|2025-03-31"]!;
    expect(iv.finalValue).toBe(1234.56);
    expect(iv.confidence).toBe("high");
  });

  it("flags missing IV/share as estimated confidence", () => {
    const recast = [mkRecast("2025-03-31")];
    const map = buildLineageMap({ recastData: recast, rawData: [] });
    const iv = map.entries["intrinsic-value-per-share|2025-03-31"]!;
    expect(iv.finalValue).toBeNull();
    expect(iv.confidence).toBe("estimated");
  });

  it("buildLineageRef returns hasLineage=false for empty map", () => {
    const ref = buildLineageRef({ entries: {}, sizeBytes: 2, truncated: false });
    expect(ref.hasLineage).toBe(false);
    expect(ref.checksum).toBe("");
  });

  it("buildLineageRef computes a stable checksum", () => {
    const recast = [mkRecast("2025-03-31")];
    const a = buildLineageMap({ recastData: recast, rawData: [] });
    const b = buildLineageMap({ recastData: recast, rawData: [] });
    expect(buildLineageRef(a).checksum).toBe(buildLineageRef(b).checksum);
    expect(buildLineageRef(a).conceptCount).toBe(LINEAGE_CONCEPT_IDS.length);
    expect(buildLineageRef(a).periodCount).toBe(1);
  });

  it("snapshot size stays under 100KB for a 12-period typical case (Plan v4 N-3 budget)", () => {
    const recast: RecastPeriod[] = [];
    for (let i = 0; i < 12; i++) {
      recast.push(mkRecast(`20${10 + i}-03-31`));
    }
    const raw = recast.map((r) => mkRaw(r.period_end));
    const map = buildLineageMap({ recastData: recast, rawData: raw });
    expect(map.sizeBytes).toBeLessThan(100 * 1024);
  });

  it("returns empty map for null/empty inputs without crashing", () => {
    const map = buildLineageMap({ recastData: null, rawData: null });
    expect(Object.keys(map.entries)).toEqual([]);
    expect(map.sizeBytes).toBeLessThan(20);
    expect(map.truncated).toBe(false);
  });
});
