import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const auditScript = resolve(projectRoot, "scripts/audit-all-companies.ts");

function runAudit(...args: string[]): string {
  return execFileSync(process.execPath, ["--import", "tsx/esm", auditScript, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
}

describe("audit-all-companies CLI routing", () => {
  it("routes banks through the financial-institution valuation path instead of industrial valuation", () => {
    const output = runAudit("--ticker=HDFCBANK");

    expect(output).toContain("Family");
    expect(output).toContain("financial-institution");
    const hdfcRow = output.split("\n").find((line) => line.startsWith("HDFC Bank"));
    expect(hdfcRow).toBeTruthy();
    expect(hdfcRow).not.toContain("shareCountInput");
    expect(hdfcRow).not.toContain("CALC_ERROR");
  }, 120_000);

  it.each([
    ["BHARTIARTL", "Bharti Airtel"],
    ["NTPC", "NTPC"],
    ["POWERGRID", "Power Grid Corporation of India Ltd"],
    ["IDEA", "Vodafone Idea Ltd"],
  ])("routes %s through a sector-native industrial valuation instead of the old scope cap", (ticker, rowPrefix) => {
    const output = runAudit(`--ticker=${ticker}`);
    const row = output.split("\n").find((line) => line.startsWith(rowPrefix));

    expect(row).toBeTruthy();
    expect(row).not.toContain("EXPECTED_SCOPE_CAP");
    expect(row).not.toContain("SECTOR_NATIVE_MODEL_PENDING");
    expect(row).toContain("VCC");
    expect(row).not.toContain("—            | EXPECTED_SCOPE_CAP");
  }, 120_000);

  it.each([
    ["GRASIM", "Grasim Industries", ["BASE_GT_BULL", "NEGATIVE_BASE"]],
    ["M&M", "Mahindra & Mahindra", ["BASE_GT_BULL"]],
    ["PAYTM", "Paytm", ["BASE_GT_BULL"]],
    ["TATASTEEL", "Tata Steel", ["BASE_GT_BULL"]],
  ])("keeps %s clean under the all-company scenario quality gate", (ticker, rowPrefix, forbiddenFlags) => {
    const output = runAudit(`--ticker=${ticker}`);
    const row = output.split("\n").find((line) => line.startsWith(rowPrefix));

    expect(row).toBeTruthy();
    expect(row).not.toContain("POLICY_WARNING");
    for (const flag of forbiddenFlags) {
      expect(row).not.toContain(flag);
    }
  }, 120_000);
});
