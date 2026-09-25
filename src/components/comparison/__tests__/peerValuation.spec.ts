/**
 * @vitest-environment jsdom
 */
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { parseCapitalineZip } from "../../../engine/capitalineParser";
import { processCompanyDataFull } from "../../../engine/pipeline";
import { buildAnchoredValuationPeriods } from "../../../engine/anchoredValuationPeriods";
import { computeValuation, deriveKwFromStructure } from "../../../engine/PenmanNissimEngine";
import { DEFAULT_CONFIG, type EngineConfig, type RecastPeriod } from "../../../engine/types";
import { CroreShares, INRAbsolute } from "../../../engine/types/units";
import { valuePeer, withPeerMarketInput, type PeerBaseRow } from "../peerValuation";

const BASE: PeerBaseRow = { id: "INFY", company: "Infosys", re: 600_000, reoi: 590_000, fcff: null, fcfe: null, ddm: null, aeg: null };

describe("withPeerMarketInput", () => {
  it("divides the peer's value by the PEER's share count, not the workspace's", () => {
    // Infosys: ₹6,00,000 Cr over its own 415 Cr shares at ₹1,500.
    const row = withPeerMarketInput(BASE, { price: 1500, shares: 415 });
    expect(row.intrinsicPerShare).toBeCloseTo(600_000 / 415, 8);
    expect(row.upside).toBeCloseTo(600_000 / 415 / 1500 - 1, 8);
  });

  it("publishes no per-share value or upside until the peer's shares are entered", () => {
    const row = withPeerMarketInput(BASE, undefined);
    expect(row.intrinsicPerShare).toBeNull();
    expect(row.upside).toBeNull();
  });
});

const ZIP_PATH = resolve(__dirname, "../../../../public/data/companies", "ITC", "ITC.zip");
const itIfData = existsSync(ZIP_PATH) ? it : it.skip;

describe("valuePeer (ITC as a peer)", () => {
  let series: RecastPeriod[] = [];
  const workspace: EngineConfig = {
    ...DEFAULT_CONFIG,
    company_type: "it-services",
    // The workspace issuer's own share count and price — must not leak in.
    shares_outstanding: CroreShares(415),
    market_price: INRAbsolute(1500),
  };

  beforeAll(async () => {
    if (!existsSync(ZIP_PATH)) return;
    const parsed = await parseCapitalineZip(new File([readFileSync(ZIP_PATH)], "ITC.zip", { type: "application/zip" }));
    series = processCompanyDataFull(parsed.periods, { ...DEFAULT_CONFIG, company_type: "consumer" }).periods;
  }, 120_000);

  itIfData("values the peer from its latest balance sheet under its own company type", () => {
    const ke = 0.12;
    const g = 0.04;
    const row = valuePeer({ id: "ITC", company: "ITC", companyType: "consumer", series }, workspace, ke, g);
    const n = series.length;
    const kw = deriveKwFromStructure(series[n - 1]!, series[n - 2]!, ke, workspace.risk_free_rate, workspace);
    const peerConfig = { ...workspace, shares_outstanding: undefined, market_price: undefined, company_type: "consumer" as const };
    const anchored = computeValuation(buildAnchoredValuationPeriods({ history: series, config: peerConfig, ke, kw, g }), ke, kw, g, peerConfig);
    expect(row.re).toBeCloseTo(anchored.V_RE_CV3!, 6);
    // The raw-history valuation is dated at ITC's oldest balance sheet.
    const rawHistory = computeValuation(series, ke, kw, g, peerConfig);
    expect(row.re).not.toBeCloseTo(rawHistory.V_RE_CV3!, 0);
  });
});
