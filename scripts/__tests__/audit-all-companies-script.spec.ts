import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const auditScript = resolve(projectRoot, "scripts/audit-all-companies.ts");
// The harness runs the app's executor, which reads the mapping spec as `?raw`.
const rawLoader = resolve(projectRoot, "scripts/lib/register-raw-loader.mjs");

function runAudit(...args: string[]): string {
  return execFileSync(process.execPath, ["--import", "tsx/esm", "--import", pathToFileURL(rawLoader).href, auditScript, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
}

describe("audit-all-companies CLI routing", () => {
  it.each([
    ["HDFCBANK", "HDFC Bank", "bank", "bank-v1"],
    ["BAJFINANCE", "Bajaj Finance", "nbfc", "nbfc-v1"],
    ["LICI", "Life Insurance Corporation of India", "insurance", "insurance-v1"],
  ])("routes %s through the financial-institution valuation path with explicit audit metadata", (ticker, rowPrefix, companyType, strategyId) => {
    const output = runAudit(`--ticker=${ticker}`);

    expect(output).toContain("CompanyType");
    expect(output).toContain("AnalysisFamily");
    expect(output).toContain("Strategy");
    expect(output).toContain("StatusClass");
    const row = output.split("\n").find((line) => line.startsWith(rowPrefix));
    expect(row).toBeTruthy();
    expect(row).toContain(companyType);
    expect(row).toContain("financial-institution");
    expect(row).toContain(strategyId);
    expect(row).not.toContain("shareCountInput");
    expect(row).not.toContain("CALC_ERROR");
  }, 120_000);

  // Routed through the industrial valuation, not capped by sector scope. NTPC and
  // Power Grid are valued (VCC); Airtel and Idea are routed the same way, but the
  // app's run withholds their valuation on a terminal period unsafe to anchor
  // on, a policy block the row names, as the app does.
  it.each([
    ["BHARTIARTL", "Bharti Airtel", "POLICY:VALUATION_BLOCKED"],
    ["NTPC", "NTPC", "VCC"],
    ["POWERGRID", "Power Grid Corporation of India Ltd", "VCC"],
    ["IDEA", "Vodafone Idea Ltd", "POLICY:VALUATION_BLOCKED"],
  ])("routes %s through the industrial valuation instead of the old scope cap", (ticker, rowPrefix, shown) => {
    const output = runAudit(`--ticker=${ticker}`);
    const row = output.split("\n").find((line) => line.startsWith(rowPrefix));

    expect(row).toBeTruthy();
    expect(row).toContain("| industrial ");
    expect(row).not.toContain("EXPECTED_SCOPE_CAP");
    expect(row).not.toContain("SECTOR_NATIVE_MODEL_PENDING");
    expect(row).toContain(shown);
    expect(row).not.toContain("—            | EXPECTED_SCOPE_CAP");
  }, 120_000);

  it.each([
    ["GRASIM", "Grasim Industries", ["BASE_GT_BULL", "NEGATIVE_BASE"]],
    ["M&M", "Mahindra & Mahindra", ["BASE_GT_BULL"]],
    ["PAYTM", "Paytm", ["BASE_GT_BULL"]],
    ["TATASTEEL", "Tata Steel", ["BASE_GT_BULL"]],
  ])("keeps %s free of raw scenario-quality flags under the all-company taxonomy", (ticker, rowPrefix, forbiddenFlags) => {
    const output = runAudit(`--ticker=${ticker}`);
    const row = output.split("\n").find((line) => line.startsWith(rowPrefix));

    expect(row).toBeTruthy();
    expect(row).not.toContain("CALC_ERROR");
    expect(row).not.toContain("MODEL_GAP");
    for (const flag of forbiddenFlags) {
      expect(row).not.toContain(flag);
    }
  }, 120_000);

  it("prints the formal PR-0.2 outcome taxonomy in the summary", () => {
    const output = runAudit("--limit=1");

    for (const outcome of [
      "PRODUCTION_READY",
      "VALUATION_ELIGIBLE_GUARDED",
      "ECONOMICALLY_PLAUSIBLE_CAPPED",
      "EXPECTED_SKIP_MISSING_SIDECAR",
      "EXPECTED_SKIP_INSUFFICIENT_HISTORY",
      "EXPECTED_SKIP_UNSUPPORTED_SOURCE",
      "MODEL_GAP",
      "POLICY_WARNING",
      "CALC_ERROR",
    ]) {
      expect(output).toContain(`  ${outcome}:`);
    }
    expect(output).not.toContain("OK_COMPUTED");
    expect(output).not.toContain("EXPECTED_SCOPE_CAP:");
  }, 120_000);
});
