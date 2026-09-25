/**
 * Company-run store for the next UI: one analysis run per company, computed
 * once and shared by every Case section, so no section recomputes the
 * pipeline (docs/ui-revamp-plan.md, Architecture).
 *
 * The run executes in the existing analysis-run worker with the same inputs
 * the current shell supplies — including the active market packs, so the
 * capital costs shown and the ones recorded are the same number (S-9.4C).
 */
import { startBrowserAnalysisRun } from "../engine/analysisRun/browserClient";
import type { LegacyAnalysisRunExecutionResult, LegacyAnalysisRunInputV1 } from "../engine/analysisRun";
import type { LiveMarketDataSnapshot } from "../engine/marketData";
import { ACTIVE_MARKET_PACKS } from "../engine/marketPacks";
import { DEFAULT_CONFIG, type EngineConfig, type RawPeriodData } from "../engine/types";
import { buildLocalLibraryCompanyUrls, type LibraryCompany } from "../components/data-entry/companyRegistry";

export type CompanyRunState =
  | { readonly status: "loading"; readonly step: "fetching" | "parsing" | "analysing" }
  | { readonly status: "ready"; readonly result: LegacyAnalysisRunExecutionResult }
  | { readonly status: "error"; readonly message: string };

export interface CompanyRunDependencies {
  readonly fetchZip: (url: string) => Promise<Uint8Array>;
  readonly parse: (bytes: Uint8Array, companyId: string) => Promise<RawPeriodData[]>;
  /** The live market overlay; null when unavailable (the run proceeds, price withheld). */
  readonly fetchMarketSnapshot: (config: EngineConfig) => Promise<LiveMarketDataSnapshot | null>;
  readonly run: (input: LegacyAnalysisRunInputV1, requestId: string) => Promise<LegacyAnalysisRunExecutionResult>;
  readonly now: () => Date;
}

const defaultDependencies: CompanyRunDependencies = {
  fetchZip: async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Company data not found (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  },
  parse: async (bytes, companyId) => {
    const { parseCapitalineZip } = await import("../engine/capitalineParser");
    return (await parseCapitalineZip(bytes, { companyId })).periods;
  },
  // Same request the current shell's useLiveMarketData makes.
  fetchMarketSnapshot: async (config) => {
    const params = new URLSearchParams({ provider: config.market_data_provider ?? "nse" });
    const symbol = config.market_data_symbol ?? config.ticker;
    if (symbol) params.set("symbol", symbol);
    if (config.market_price != null && Number.isFinite(config.market_price)) params.set("fallbackPrice", String(config.market_price));
    if (config.risk_free_rate != null && Number.isFinite(config.risk_free_rate)) params.set("fallbackRiskFreeRate", String(config.risk_free_rate));
    try {
      const response = await fetch(`/api/market-data/snapshot?${params.toString()}`, { headers: { "x-penman-local": "1" } });
      if (!response.ok) return null;
      const payload = (await response.json()) as { snapshot?: LiveMarketDataSnapshot | null };
      return payload.snapshot ?? null;
    } catch {
      return null;
    }
  },
  run: (input, requestId) => startBrowserAnalysisRun({ requestId, input }).result,
  now: () => new Date(),
};

export function configForCompany(company: Pick<LibraryCompany, "ticker" | "type">): EngineConfig {
  return { ...DEFAULT_CONFIG, company_type: company.type, ticker: company.ticker };
}

/**
 * Load and analyse one company. `onStep` reports progress; the promise
 * settles to the final state and never rejects.
 */
export async function loadCompanyRun(
  company: LibraryCompany,
  onStep: (step: "fetching" | "parsing" | "analysing") => void = () => {},
  deps: CompanyRunDependencies = defaultDependencies,
): Promise<Exclude<CompanyRunState, { status: "loading" }>> {
  try {
    onStep("fetching");
    const bytes = await deps.fetchZip(buildLocalLibraryCompanyUrls(company).consolidated);
    onStep("parsing");
    const issuerId = company.ticker.toUpperCase();
    const config = configForCompany(company);
    const [rawData, marketSnapshot] = await Promise.all([deps.parse(bytes, issuerId), deps.fetchMarketSnapshot(config)]);
    if (rawData.length === 0) return { status: "error", message: "The company's data parsed to zero periods." };
    onStep("analysing");
    const now = deps.now().toISOString();
    const runId = `next-${issuerId}-${now}`;
    const input: LegacyAnalysisRunInputV1 = {
      rawData,
      config,
      marketSnapshot,
      ...ACTIVE_MARKET_PACKS,
      metadata: {
        runId,
        issuerId,
        asOf: now.slice(0, 10),
        createdAt: now,
        generatedAt: now,
        sourceMode: "manual",
        relation: { kind: "root", parentRunId: null, parentReproducibilityHash: null },
        contentClass: null,
        retentionDays: null,
        runInspectorEnabled: false,
      },
    };
    return { status: "ready", result: await deps.run(input, runId) };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

/** One in-flight or settled run per company folder for the session. */
export class CompanyRunCache {
  private readonly runs = new Map<string, Promise<Exclude<CompanyRunState, { status: "loading" }>>>();

  constructor(private readonly deps: CompanyRunDependencies = defaultDependencies) {}

  get(company: LibraryCompany, onStep?: (step: "fetching" | "parsing" | "analysing") => void) {
    let run = this.runs.get(company.folder);
    if (!run) {
      run = loadCompanyRun(company, onStep, this.deps);
      this.runs.set(company.folder, run);
      // A failure is not cached: revisiting the company retries.
      void run.then((state) => {
        if (state.status === "error") this.runs.delete(company.folder);
      });
    }
    return run;
  }
}
