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
import type { BankQualityIndicators } from "../engine/bankQualityIndicators";
import { ACTIVE_MARKET_PACKS } from "../engine/marketPacks";
import type { CapitalineParseDebug } from "../engine/capitalineParser/types";
import { DEFAULT_CONFIG, type CompanyRegistry, type EngineConfig, type RawPeriodData, type RecastPeriod } from "../engine/types";
import type { SegmentData } from "../engine/segmentParser";
import { buildLocalLibraryCompanyUrls, type LibraryCompany } from "../components/data-entry/companyRegistry";

export type CompanyRunState =
  | { readonly status: "loading"; readonly step: "fetching" | "parsing" | "analysing" }
  | {
      readonly status: "ready";
      readonly result: LegacyAnalysisRunExecutionResult;
      /**
       * The parser's diagnostics, for the Lab's Debug tool. Held beside the run,
       * not passed into it: the run's inputs (and so its reproducibility hash
       * and trust envelope) stay what the Case sections were built on.
       */
      readonly debug?: CapitalineParseDebug | null;
      /** Which accounts the run analysed; standalone only when consolidated history is too short. */
      readonly basis?: "consolidated" | "standalone";
    }
  | { readonly status: "error"; readonly message: string };

export interface CompanyRunDependencies {
  readonly fetchZip: (url: string) => Promise<Uint8Array>;
  readonly parse: (bytes: Uint8Array, companyId: string) => Promise<{
    readonly periods: RawPeriodData[];
    readonly debug: CapitalineParseDebug | null;
    /** The business segments (else the mixed ones): the segment SOTP's input and a lending arm's carve-out. */
    readonly segmentData?: SegmentData | null | undefined;
  }>;
  /** The live market overlay; null when unavailable (the run proceeds, price withheld). */
  readonly fetchMarketSnapshot: (config: EngineConfig) => Promise<LiveMarketDataSnapshot | null>;
  readonly run: (input: LegacyAnalysisRunInputV1, requestId: string) => Promise<LegacyAnalysisRunExecutionResult>;
  readonly now: () => Date;
  /**
   * A financial institution's quality sidecar (quality_indicators.json): asset
   * quality and capital ratios, an insurer's embedded value and VNB, an NBFC's
   * AUM. Without it an insurer has no headline value at all (it is valued on
   * embedded value alone) and the NBFC P/AUM lens never computes. Optional:
   * absent, the run has no sidecar.
   */
  readonly fetchBankQuality?: (company: LibraryCompany) => Promise<BankQualityIndicators | null>;
}

const defaultDependencies: CompanyRunDependencies = {
  fetchZip: async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Company data not found (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  },
  parse: async (bytes, companyId) => {
    const { parseCapitalineZip } = await import("../engine/capitalineParser");
    const { periods, debug, segmentData } = await parseCapitalineZip(bytes, { companyId });
    return { periods, debug, segmentData: segmentData?.business ?? segmentData?.mixed ?? null };
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
  // Same library path the classic shell's batch loader reads.
  fetchBankQuality: async (company) => {
    if (company.type !== "bank" && company.type !== "nbfc" && company.type !== "insurance") return null;
    const { fetchBankQualityIndicators } = await import("../engine/bankQualityIndicators");
    try {
      return await fetchBankQualityIndicators(company.folder);
    } catch {
      return null;
    }
  },
};

/** Below this many consolidated years, a library company with standalone accounts is analysed on those. */
const MIN_CONSOLIDATED_YEARS = 3;

export function configForCompany(company: Pick<LibraryCompany, "ticker" | "type">): EngineConfig {
  return { ...DEFAULT_CONFIG, company_type: company.type, ticker: company.ticker };
}

/**
 * Load and analyse one company. `onStep` reports progress; the promise
 * settles to the final state and never rejects.
 *
 * With `asOf`, the run is the company as of that date: only periods ending on
 * or before it, no live market overlay (today's price is not point-in-time),
 * and the run's analysis date set to it — so the executor refuses any later
 * period (RAW_PERIOD_AFTER_AS_OF) and the market packs refuse later-dated
 * observations as look-ahead.
 */
export async function loadCompanyRun(
  company: LibraryCompany,
  onStep: (step: "fetching" | "parsing" | "analysing") => void = () => {},
  deps: CompanyRunDependencies = defaultDependencies,
  asOf: string | null = null,
  /** The company's zip, when the reader uploaded it; otherwise it is fetched from the library. */
  uploaded: Uint8Array | null = null,
): Promise<Exclude<CompanyRunState, { status: "loading" }>> {
  try {
    onStep("fetching");
    const bytes = uploaded ?? await deps.fetchZip(buildLocalLibraryCompanyUrls(company).consolidated);
    onStep("parsing");
    const issuerId = company.ticker.toUpperCase();
    const config = configForCompany(company);
    const [consolidated, marketSnapshot, bankQuality] = await Promise.all([
      deps.parse(bytes, issuerId),
      asOf ? Promise.resolve(null) : deps.fetchMarketSnapshot(config),
      // The library's sidecar describes the library's accounts; an uploaded zip
      // may be another vintage, so it gets none.
      uploaded || !deps.fetchBankQuality ? Promise.resolve(null) : deps.fetchBankQuality(company),
    ]);
    // A company that has only just begun consolidating (Nestlé India: two
    // consolidated years, FY24-25, beside a standalone history back to Dec 2011)
    // cannot be valued on its consolidated accounts — valuation needs two
    // years with ratio context. Use the standalone history instead, and say so.
    let parsed = consolidated;
    let basis: "consolidated" | "standalone" = "consolidated";
    if (!uploaded && company.hasStandalone === true && consolidated.periods.length < MIN_CONSOLIDATED_YEARS) {
      const standalone = await deps.parse(await deps.fetchZip(buildLocalLibraryCompanyUrls(company).standalone), issuerId);
      if (standalone.periods.length > consolidated.periods.length) {
        parsed = standalone;
        basis = "standalone";
      }
    }
    if (parsed.periods.length === 0) return { status: "error", message: "The company's data parsed to zero periods." };
    const rawData = asOf ? parsed.periods.filter((p) => p.period_end <= asOf) : parsed.periods;
    if (asOf && rawData.length < 2) {
      return { status: "error", message: `Fewer than two reported years end on or before ${asOf}; the analysis needs at least two.` };
    }
    onStep("analysing");
    const now = deps.now().toISOString();
    const runId = `next-${issuerId}${asOf ? `-asof-${asOf}` : ""}-${now}`;
    const input: LegacyAnalysisRunInputV1 = {
      rawData,
      config,
      marketSnapshot,
      // The sidecar is joined to the metrics by period, so an as-of run never
      // reads a later year's row. It describes the consolidated entity, so a
      // standalone-basis run does not get it.
      bankQuality: basis === "consolidated" ? bankQuality : null,
      // The segments the analysed accounts report, as the audit harness reads
      // them: without them the run had no segment SOTP and could not carve a
      // lending arm out of the parent's segment note.
      ...(parsed.segmentData ? { segmentData: parsed.segmentData } : {}),
      ...ACTIVE_MARKET_PACKS,
      metadata: {
        runId,
        issuerId,
        asOf: asOf ?? now.slice(0, 10),
        createdAt: now,
        generatedAt: now,
        sourceMode: "manual",
        relation: { kind: "root", parentRunId: null, parentReproducibilityHash: null },
        contentClass: null,
        retentionDays: null,
        runInspectorEnabled: false,
      },
    };
    return { status: "ready", result: await deps.run(input, runId), debug: parsed.debug, basis };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

/** One in-flight or settled run per company and as-of date for the session. */
export class CompanyRunCache {
  private readonly runs = new Map<string, Promise<Exclude<CompanyRunState, { status: "loading" }>>>();
  private readonly uploads = new Map<string, Uint8Array>();
  /** Latest (not as-of) runs that have settled ready, by folder. */
  private readonly ready = new Map<string, { company: LibraryCompany; result: LegacyAnalysisRunExecutionResult }>();

  constructor(private readonly deps: CompanyRunDependencies = defaultDependencies) {}

  /**
   * Hold a reader-uploaded zip for a company. Runs of that company then read
   * these bytes instead of the library, and any earlier run of it is dropped.
   */
  registerUpload(company: LibraryCompany, bytes: Uint8Array) {
    this.uploads.set(company.folder, bytes);
    this.ready.delete(company.folder);
    for (const key of [...this.runs.keys()]) if (key.startsWith(`${company.folder}|`)) this.runs.delete(key);
  }

  /**
   * The companies analysed this session, in the classic registry's shape, for
   * the Lab's Regression tool ("loaded in session"). Keyed by the run's issuer
   * id; the periods are the runs' own and must only be read.
   */
  registry(): CompanyRegistry {
    return {
      companies: Object.fromEntries([...this.ready.values()].map(({ company, result }) => {
        const id = company.ticker.toUpperCase();
        return [id, {
          id,
          label: company.name,
          rawData: result.materialization.rawData as unknown as RawPeriodData[],
          recastData: (result.materialization.pipelineResult?.periods ?? []) as unknown as RecastPeriod[],
          companyType: company.type,
        }];
      })),
    };
  }

  get(company: LibraryCompany, onStep?: (step: "fetching" | "parsing" | "analysing") => void, asOf: string | null = null) {
    const key = `${company.folder}|${asOf ?? "latest"}`;
    let run = this.runs.get(key);
    if (!run) {
      run = loadCompanyRun(company, onStep, this.deps, asOf, this.uploads.get(company.folder) ?? null);
      this.runs.set(key, run);
      // A failure is not cached: revisiting the company retries.
      void run.then((state) => {
        if (state.status === "error") this.runs.delete(key);
        else if (!asOf && this.runs.get(key) === run) this.ready.set(company.folder, { company, result: state.result });
      });
    }
    return run;
  }
}
