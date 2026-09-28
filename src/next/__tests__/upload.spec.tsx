import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import type { RawPeriodData } from "../../engine/types";
import type { LibraryCompany } from "../../components/data-entry/companyRegistry";
import { CompanyRunCache, loadCompanyRun, type CompanyRunDependencies } from "../companyRun";
import { LibraryPage } from "../LibraryPage";
import { uploadedCompany, validateUpload } from "../UploadPanel";

const tcs: LibraryCompany = { folder: "TCS", name: "TCS", ticker: "TCS", sector: "IT", type: "it-services", description: "", emoji: "" };
const periods = ["2024-03-31", "2025-03-31"].map((period_end) => ({ company_id: "X", period_end, raw_metric_values: {} }) as RawPeriodData);
const result = { status: "completed" } as unknown as LegacyAnalysisRunExecutionResult;

function deps(overrides: Partial<CompanyRunDependencies> = {}): CompanyRunDependencies {
  return {
    fetchZip: vi.fn(async () => new Uint8Array([9])),
    parse: vi.fn(async () => ({ periods, debug: null })),
    fetchMarketSnapshot: async () => null,
    run: vi.fn(async () => result),
    now: () => new Date("2026-09-27T10:00:00Z"),
    ...overrides,
  };
}

describe("upload validation", () => {
  const draft = { fileName: "acme.zip", name: "Acme Ltd", ticker: "acme", type: "industrial" };

  it("accepts a complete draft and names the company by its upper-cased ticker", () => {
    expect(validateUpload(draft, [tcs])).toEqual([]);
    expect(uploadedCompany(draft)).toMatchObject({ folder: "upload-ACME", ticker: "ACME", name: "Acme Ltd", type: "industrial" });
  });

  it("lists everything wrong, in reading order", () => {
    expect(validateUpload({ fileName: null, name: " ", ticker: "bad ticker!", type: "" }, [tcs])).toEqual([
      "Choose a Capitaline export (.zip).",
      "Give the company a name.",
      "The ticker must be 1–20 letters, digits, &, . or -.",
      "Choose the company type.",
    ]);
    expect(validateUpload({ ...draft, fileName: "acme.xlsx" }, [tcs])).toEqual(["The file must be a Capitaline .zip export."]);
  });

  it("refuses a ticker that would shadow a library company", () => {
    expect(validateUpload({ ...draft, ticker: "tcs" }, [tcs])).toEqual(["TCS is already in the library; use another ticker."]);
  });
});

describe("run store with an uploaded zip", () => {
  const acme = uploadedCompany({ fileName: "acme.zip", name: "Acme Ltd", ticker: "ACME", type: "industrial" });

  it("analyses the uploaded bytes instead of fetching from the library", async () => {
    const d = deps();
    const bytes = new Uint8Array([1, 2, 3]);
    const state = await loadCompanyRun(acme, undefined, d, null, bytes);
    expect(state.status).toBe("ready");
    expect(d.fetchZip).not.toHaveBeenCalled();
    expect(d.parse).toHaveBeenCalledWith(bytes, "ACME");
  });

  it("uses a registered upload, and re-runs when the company is uploaded again", async () => {
    const d = deps();
    const cache = new CompanyRunCache(d);
    const first = new Uint8Array([1]);
    const second = new Uint8Array([2]);
    cache.registerUpload(acme, first);
    await cache.get(acme);
    await cache.get(acme);
    cache.registerUpload(acme, second);
    await cache.get(acme);
    expect(d.fetchZip).not.toHaveBeenCalled();
    expect(vi.mocked(d.parse).mock.calls.map(([b]) => b)).toEqual([first, second]);
  });
});

describe("Library with uploads", () => {
  it("lists this session's uploads and offers the upload panel", () => {
    const acme = uploadedCompany({ fileName: "acme.zip", name: "Acme Ltd", ticker: "ACME", type: "industrial" });
    const html = renderToStaticMarkup(
      <LibraryPage registry={{ status: "ready", companies: [tcs] }} uploaded={[{ company: acme, bytes: new Uint8Array() }]} onUpload={() => {}} />,
    );
    expect(html).toContain("Uploaded this session");
    expect(html).toContain('href="#/case/ACME/verdict"');
    expect(html).toContain("Upload a Capitaline export");
    expect(html).toContain("only the ticker leaves it");
  });
});
