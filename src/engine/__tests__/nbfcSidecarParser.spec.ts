/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve } from "path";
import { parseLgdFile, parseLgdFiles, parseRbiNhbFile } from "../nbfcSidecarParser";

const lgdDir = resolve(__dirname, "../../../public/data/companies/Bajaj Finance/Loss Given Default");
const nhbPath = resolve(__dirname, "../../../public/data/companies/Bajaj Finance/RBI NHB Banks/RBINHBBanks_.xls");

const lgdExists = existsSync(lgdDir);
const nhbExists = existsSync(nhbPath);

describe.skipIf(!lgdExists)("LGD parser", () => {
  it("parses a single LGD file into stage migration matrix", () => {
    const html = readFileSync(resolve(lgdDir, "LossGivenDefault_.xls"), "utf-8");
    const result = parseLgdFile(html);

    expect(result.gross_carrying.opening).not.toBeNull();
    expect(result.gross_carrying.closing).not.toBeNull();
    expect(result.gross_carrying.opening!.total).toBeCloseTo(331334.35, 0);
    expect(result.gross_carrying.closing!.total).toBeCloseTo(414826.5, 0);
    expect(result.gross_carrying.closing!.stage1).toBeCloseTo(405457.84, 0);
    expect(result.gross_carrying.closing!.stage3).toBeCloseTo(3964.74, 0);
    expect(result.gross_carrying.writeoff!.stage3).toBeCloseTo(-7063.43, 0);
    expect(result.gross_carrying.transfer_to_s3!.stage1).toBeCloseTo(-7306.08, 0);
  });

  it("parses all 7 LGD files and assigns fiscal years", () => {
    const files = readdirSync(lgdDir)
      .filter(f => f.endsWith(".xls"))
      .map(f => ({
        filename: f,
        html: readFileSync(resolve(lgdDir, f), "utf-8"),
      }));

    const result = parseLgdFiles(files);
    expect(result).toHaveLength(7);

    // Should be sorted oldest to newest
    const labels = result.map(r => r.fiscal_label);
    expect(labels[0]).toBe("FY2019");
    expect(labels[6]).toBe("FY2025");

    // FY2025 closing should match known value
    const fy25 = result.find(r => r.fiscal_label === "FY2025")!;
    expect(fy25.gross_carrying.closing!.total).toBeCloseTo(414826.5, 0);

    // Chain validation: closing of FY2024 ≈ opening of FY2025
    const fy24 = result.find(r => r.fiscal_label === "FY2024")!;
    expect(fy24.gross_carrying.closing!.total).toBeCloseTo(
      fy25.gross_carrying.opening!.total!, 0
    );
  });

  it("stage transfers sum to zero across stages (conservation)", () => {
    const html = readFileSync(resolve(lgdDir, "LossGivenDefault_.xls"), "utf-8");
    const result = parseLgdFile(html);

    // Transfers to Stage 1: sum across stages should be ~0
    const t1 = result.gross_carrying.transfer_to_s1!;
    const sum1 = (t1.stage1 ?? 0) + (t1.stage2 ?? 0) + (t1.stage3 ?? 0);
    expect(Math.abs(sum1)).toBeLessThan(1); // rounding tolerance
  });
});

describe.skipIf(!nhbExists)("RBI NHB parser", () => {
  it("parses RBI NHB file into period records", () => {
    const html = readFileSync(nhbPath, "utf-8");
    const result = parseRbiNhbFile(html);

    expect(result.length).toBe(15);
    expect(result[0].fiscal_label).toBe("FY2025");
    expect(result[0].period_code).toBe("202503");
    expect(result[14].fiscal_label).toBe("FY2011");
  });

  it("extracts GNPA and capital adequacy for FY2025", () => {
    const html = readFileSync(nhbPath, "utf-8");
    const result = parseRbiNhbFile(html);
    const fy25 = result[0];

    expect(fy25.gnpa_cr).toBeCloseTo(3677.75, 0);
    expect(fy25.nnpa_cr).toBeCloseTo(1720.41, 0);
    expect(fy25.crar_pct).toBeCloseTo(21.93, 1);
    expect(fy25.tier1_pct).toBeCloseTo(21.09, 1);
  });

  it("extracts NPA movement data", () => {
    const html = readFileSync(nhbPath, "utf-8");
    const result = parseRbiNhbFile(html);
    const fy25 = result[0];

    expect(fy25.gnpa_opening_cr).toBeCloseTo(2600.38, 0);
    expect(fy25.gnpa_additions_cr).toBeCloseTo(11044.26, 0);
    expect(fy25.gnpa_closing_cr).toBeCloseTo(3677.75, 0);
    expect(fy25.provisions_made_cr).toBeCloseTo(9930.17, 0);
  });

  it("handles periods with zero data gracefully", () => {
    const html = readFileSync(nhbPath, "utf-8");
    const result = parseRbiNhbFile(html);
    // FY2011 should have mostly null/zero
    const fy11 = result.find(r => r.fiscal_label === "FY2011")!;
    expect(fy11.gnpa_cr).not.toBeNull(); // has some data
  });
});
