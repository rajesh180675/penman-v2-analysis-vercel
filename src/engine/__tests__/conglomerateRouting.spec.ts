import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parseSegmentFinanceHTML } from "../segmentParser";
import { segmentDataToDefinitions, runSOTPFromSegmentData } from "../segmentSOTPBridge";
import { classifySegmentSector } from "../segmentSOTPBridge";
import { SOTP_PRESETS } from "../sotpValuation";
import { RecastPeriod } from "../types";

// Raw .xls fixtures are gitignored — present locally, absent in CI.
const relianceDir = resolve(__dirname, "../../../public/data/companies/Reliance Industries");
const itcDir = resolve(__dirname, "../../../public/data/companies/ITC");
const fixturesAvailable =
  existsSync(resolve(relianceDir, "SegmentFinance_.xls")) &&
  existsSync(resolve(itcDir, "SegmentFinance_.xls"));

describe.skipIf(!fixturesAvailable)("conglomerateRouting (Phase C5)", () => {
  describe("Reliance Industries segment parsing + SOTP", () => {
    it("parses Reliance segment file and produces valid definitions", () => {
      const html = readFileSync(resolve(relianceDir, "SegmentFinance_.xls"), "utf-8");
      const segData = parseSegmentFinanceHTML(html);
      expect(segData).not.toBeNull();
      expect(segData!.segmentationType).toBe("business");

      const { definitions, timeSeries } = segmentDataToDefinitions(segData!);
      expect(definitions.length).toBeGreaterThanOrEqual(3);
      expect(timeSeries.length).toBeGreaterThanOrEqual(3);

      // All shares should sum to ~1
      const totalShare = definitions.reduce((s, d) => s + d.operatingProfitShare, 0);
      expect(totalShare).toBeCloseTo(1.0, 1);

      // Sector templates should span multiple types (conglomerate)
      const templates = new Set(definitions.map(d => d.sectorTemplate));
      expect(templates.size).toBeGreaterThanOrEqual(2);
    });

    it("classifies Reliance segment names into expected sector templates", () => {
      // Based on known Reliance segment names
      expect(classifySegmentSector("OIL TO CHEMICALS")).toBe("commodities");
      expect(classifySegmentSector("OIL AND GAS")).toBe("commodities");
      expect(classifySegmentSector("DIGITAL SERVICES")).toBe("services");
      expect(classifySegmentSector("RETAIL")).toBe("retail");
      expect(classifySegmentSector("FINANCIAL SERVICES")).toBe("services");
    });

    it("runs SOTP from parsed segment data and produces positive EV", () => {
      const html = readFileSync(resolve(relianceDir, "SegmentFinance_.xls"), "utf-8");
      const segData = parseSegmentFinanceHTML(html);
      expect(segData).not.toBeNull();

      // Build a minimal RecastPeriod for SOTP
      const period = {
        period_end: "2025-03-31",
        is: { OI: 150000, taxRate: 0.25 },
        bs: { NOA: 800000, CSE: 500000, NFO: 100000 },
      } as unknown as RecastPeriod;

      const result = runSOTPFromSegmentData(segData!, period, 0.12);
      expect(result.totalEnterpriseValue).toBeGreaterThan(0);
      expect(result.segments.length).toBeGreaterThanOrEqual(3);
      expect(result.dataSource).toBe("parsed");
      expect(result.conglomerateDiscountPct).toBeGreaterThanOrEqual(0);
    });
  });

  describe("ConglomerateAssessment logic", () => {
    it("produces conglomerate assessment from parsed ITC segment data", () => {
      const html = readFileSync(resolve(itcDir, "SegmentFinance_.xls"), "utf-8");
      const segData = parseSegmentFinanceHTML(html);
      expect(segData).not.toBeNull();

      const { definitions } = segmentDataToDefinitions(segData!);
      const distinctTemplates = new Set(definitions.map(d => d.sectorTemplate));
      const maxShare = Math.max(...definitions.map(d => d.operatingProfitShare));
      const dominantDef = definitions.reduce((a, b) => a.operatingProfitShare > b.operatingProfitShare ? a : b, definitions[0]!);
      const isConglomerate = definitions.length >= 3 && distinctTemplates.size >= 2;

      expect(isConglomerate).toBe(true);
      expect(definitions.length).toBeGreaterThanOrEqual(4);
      expect(distinctTemplates.size).toBeGreaterThanOrEqual(3); // consumer-staples, commodities, services, industrials
      expect(maxShare).toBeLessThan(1); // no single segment dominates entirely
      expect(dominantDef.name).toContain("CIGARETTES");
    });

    it("Reliance segment data produces conglomerate assessment", () => {
      const html = readFileSync(resolve(relianceDir, "SegmentFinance_.xls"), "utf-8");
      const segData = parseSegmentFinanceHTML(html);
      expect(segData).not.toBeNull();

      const { definitions } = segmentDataToDefinitions(segData!);
      const distinctTemplates = new Set(definitions.map(d => d.sectorTemplate));
      const isConglomerate = definitions.length >= 3 && distinctTemplates.size >= 2;

      expect(isConglomerate).toBe(true);
      expect(definitions.length).toBeGreaterThanOrEqual(3);
      expect(distinctTemplates.size).toBeGreaterThanOrEqual(2);
    });

    it("preset-based conglomerate assessment for Reliance", () => {
      const presetDefs = SOTP_PRESETS["Reliance Industries"]!;
      expect(presetDefs).toBeDefined();
      const distinctTemplates = new Set(presetDefs.map(d => d.sectorTemplate));
      const maxShare = Math.max(...presetDefs.map(d => d.operatingProfitShare));
      const isConglomerate = presetDefs.length >= 3 && distinctTemplates.size >= 2;

      expect(isConglomerate).toBe(true);
      expect(presetDefs.length).toBe(5);
      expect(distinctTemplates.size).toBe(3); // commodities, services, retail
      expect(maxShare).toBe(0.35); // O2C is dominant
    });

    it("non-conglomerate: single-segment company is not flagged", () => {
      // Simulated: single-template definitions
      const singleTemplateDefs = [
        { name: "Segment A", operatingProfitShare: 0.6, sectorTemplate: "industrials" as const },
        { name: "Segment B", operatingProfitShare: 0.4, sectorTemplate: "industrials" as const },
      ];
      const distinctTemplates = new Set(singleTemplateDefs.map(d => d.sectorTemplate));
      const isConglomerate = singleTemplateDefs.length >= 3 && distinctTemplates.size >= 2;
      expect(isConglomerate).toBe(false);
    });
  });

  describe("Reliance SOTP preset", () => {
    it("Reliance Industries preset exists and sums to 1.0", () => {
      const defs = SOTP_PRESETS["Reliance Industries"]!;
      expect(defs).toBeDefined();
      expect(defs.length).toBe(5);
      const totalShare = defs.reduce((s, d) => s + d.operatingProfitShare, 0);
      expect(totalShare).toBeCloseTo(1.0, 2);
    });
  });
});
