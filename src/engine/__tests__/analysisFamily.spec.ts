import { describe, expect, it } from "vitest";
import {
  financialInstitutionTabLabel,
  type FinancialInstitutionSubtype,
} from "../analysisFamily";

describe("financialInstitutionTabLabel", () => {
  it("names the tab after the loaded subtype", () => {
    expect(financialInstitutionTabLabel("bank")).toBe("Bank");
    expect(financialInstitutionTabLabel("nbfc")).toBe("NBFC");
    expect(financialInstitutionTabLabel("insurance")).toBe("Insurance");
  });

  it("shortens generic-financial to fit a tab", () => {
    // bankExcelExport's subtypeDisplayLabel says "Generic Financial" — fine for
    // a worksheet name, too wide for the sidebar and header.
    expect(financialInstitutionTabLabel("generic-financial")).toBe("Financial");
  });

  it("covers every subtype in the union with a non-empty label", () => {
    // Guards the next subtype added to FinancialInstitutionSubtype: without a
    // case it would fall through to "Bank" and mislabel a non-bank institution.
    const subtypes: FinancialInstitutionSubtype[] = ["bank", "nbfc", "insurance", "generic-financial"];
    const labels = subtypes.map(financialInstitutionTabLabel);
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(subtypes.length);
  });

  it("keeps labels short enough for the tab strip", () => {
    const subtypes: FinancialInstitutionSubtype[] = ["bank", "nbfc", "insurance", "generic-financial"];
    for (const subtype of subtypes) {
      expect(financialInstitutionTabLabel(subtype).length).toBeLessThanOrEqual(10);
    }
  });
});
