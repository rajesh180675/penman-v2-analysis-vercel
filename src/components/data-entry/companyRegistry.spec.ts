import { describe, expect, it } from "vitest";
import {
  buildLocalLibraryCompanyUrls,
  findLibraryCompany,
  parseLibraryCompanyRegistry,
  type LibraryCompany,
} from "./companyRegistry";

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
    expect(parsed.companies[0]!.folder).toBe("ITC");
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

describe("bundled company deep links", () => {
  const tcs: LibraryCompany = {
    folder: "Tata Consultancy Services Ltd",
    name: "TCS",
    ticker: "TCS",
    sector: "IT Services",
    type: "it-services",
    description: "Global IT services leader",
    emoji: "💻",
    hasStandalone: true,
  };

  it("resolves ticker, name, and folder tokens case-insensitively", () => {
    expect(findLibraryCompany([tcs], "tcs")).toBe(tcs);
    expect(findLibraryCompany([tcs], "Tata Consultancy Services Ltd")).toBe(tcs);
    expect(findLibraryCompany([{ ...tcs, folder: "Asian Paints", name: "Asian Paints", ticker: "ASIANPAINT" }], "Asian_Paints")?.ticker).toBe("ASIANPAINT");
    expect(findLibraryCompany([tcs], "missing")).toBeNull();
  });

  it("builds the exact Vite-served TCS asset URLs", () => {
    expect(buildLocalLibraryCompanyUrls(tcs)).toEqual({
      consolidated: "/data/companies/Tata%20Consultancy%20Services%20Ltd/Tata%20Consultancy%20Services%20Ltd.zip",
      standalone: "/data/companies/Tata%20Consultancy%20Services%20Ltd/standalone.zip",
    });
  });
});
