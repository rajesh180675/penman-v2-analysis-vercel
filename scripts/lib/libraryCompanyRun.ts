import { readFileSync } from "node:fs";
import { join } from "node:path";
import { executeLegacyAnalysisRun } from "../../src/engine/analysisRun";
import type { BankQualityIndicators } from "../../src/engine/bankQualityIndicators";
import { parseCapitalineZip } from "../../src/engine/capitalineParser";
import type { LibraryCompany } from "../../src/components/data-entry/companyRegistry";
import { loadCompanyRun, type CompanyRunState } from "../../src/next/companyRun";

/**
 * The app's own run of a library company (src/next/companyRun.ts), with the
 * library read from disk: the run the audit harness certifies and the forecast
 * accountability runner freezes. One loader for both, so neither can drift
 * from the app, or from the other, in how a company is loaded.
 *
 * `now` is the run's clock: its analysis date, timestamps and run id, and the
 * date the market packs are resolved on. No live market price is supplied.
 */
export async function runLibraryCompany(
  projectRoot: string,
  company: LibraryCompany,
  options: {
    readonly now: Date;
    /** The company's quality sidecar, for a financial institution; none otherwise. */
    readonly bankQuality?: BankQualityIndicators | null;
    /** Each parse, in the order the run reads them: consolidated first, then standalone. */
    readonly onParse?: (result: Awaited<ReturnType<typeof parseCapitalineZip>>) => void;
  },
): Promise<Exclude<CompanyRunState, { status: "loading" }>> {
  return loadCompanyRun(company, undefined, {
    fetchZip: async (url) => {
      const buf = readFileSync(join(projectRoot, "public", decodeURIComponent(url)));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    parse: async (bytes, companyId) => {
      const result = await parseCapitalineZip(bytes, { companyId });
      options.onParse?.(result);
      return { periods: result.periods, debug: result.debug, segmentData: result.segmentData?.business ?? result.segmentData?.mixed ?? null };
    },
    fetchMarketSnapshot: async () => null,
    run: (input) => executeLegacyAnalysisRun(input),
    now: () => options.now,
    fetchBankQuality: async () => options.bankQuality ?? null,
  });
}
