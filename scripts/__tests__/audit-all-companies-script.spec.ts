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
});
