import { describe, expect, it } from "vitest";
import { parseLibraryCompanyRegistry } from "./companyRegistry";

describe("parseLibraryCompanyRegistry", () => {
  it("keeps valid entries and rejects malformed rows before UI use", () => {
    const parsed = parseLibraryCompanyRegistry([
      {
        folder: "ITC",
        name: "ITC Ltd",
        ticker: "ITC",
        sector: "FMCG",
        type: "consumer",
        description: "Valid company",
        emoji: "🚬",
        hasStandalone: true,
      },
      {
        folder: "BROKEN",
        name: "Broken Co",
        ticker: "BROKEN",
        sector: "Test",
        type: "unknown-type",
        description: "Invalid type should be rejected",
        emoji: "?",
      },
      {
        folder: "NOSECTOR",
        name: "No Sector",
        ticker: "NOSECTOR",
        type: "industrial",
        description: "Missing sector should be rejected",
        emoji: "?",
      },
    ]);

    expect(parsed.companies).toHaveLength(1);
    expect(parsed.companies[0].folder).toBe("ITC");
    expect(parsed.errors).toEqual([
      "registry[1].type is not supported: unknown-type",
      "registry[2].sector is required",
    ]);
  });

  it("rejects duplicate folders and tickers to avoid ambiguous routing", () => {
    const parsed = parseLibraryCompanyRegistry([
      {
        folder: "ITC",
        name: "ITC Ltd",
        ticker: "ITC",
        sector: "FMCG",
        type: "consumer",
        description: "Valid company",
        emoji: "🚬",
      },
      {
        folder: "ITC",
        name: "ITC Duplicate Folder",
        ticker: "ITC2",
        sector: "FMCG",
        type: "consumer",
        description: "Duplicate folder",
        emoji: "🚬",
      },
      {
        folder: "ITC Other Folder",
        name: "ITC Duplicate Ticker",
        ticker: "ITC",
        sector: "FMCG",
        type: "consumer",
        description: "Duplicate ticker",
        emoji: "🚬",
      },
    ]);

    expect(parsed.companies.map((company) => company.name)).toEqual(["ITC Ltd"]);
    expect(parsed.errors).toEqual([
      "registry[1].folder duplicates ITC",
      "registry[2].ticker duplicates ITC",
    ]);
  });
});
