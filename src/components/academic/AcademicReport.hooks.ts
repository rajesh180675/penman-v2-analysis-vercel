import { RecastPeriod } from "../../engine/types";
import { median, madSigma } from "./AcademicReport.formatters";

export function computeSection6BLocal(params: {
  primaryValue: number;
  ke: number;
  g: number;
  cse0: number;
  pvRE: number;
  reAnchor: number;
  explicitPeriods: number;
  periods: RecastPeriod[];
  shares: number | null;
  marketPrice: number | null | undefined;
  sharesSource: string;
}) {
  const { primaryValue, ke, g, cse0, pvRE, reAnchor, explicitPeriods, periods, shares, marketPrice, sharesSource } = params;
  if (!shares || shares <= 0) return { status: "shares_unavailable" as const };

  const intrinsic = primaryValue / shares;
  if (marketPrice == null || marketPrice <= 0) {
    return {
      status: "market_price_required" as const,
      shares,
      sharesSource,
      intrinsic,
      prompt: `Intrinsic value per share: ₹${intrinsic.toFixed(1)}. Enter market price to compute margin of safety and implied values.`,
    };
  }

  const marketCap = marketPrice * shares;
  const mos = (intrinsic - marketPrice) / marketPrice;

  const vAtG = (gt: number) => {
    if (gt >= ke - 0.001) return Number.POSITIVE_INFINITY;
    const cv = reAnchor * (1 + gt) / (ke - gt);
    return cse0 + pvRE + cv / Math.pow(1 + ke, explicitPeriods);
  };

  let impliedG: number | null = null;
  let lo = -0.10;
  let hi = ke - 0.005;
  if (vAtG(hi) >= marketCap && vAtG(lo) <= marketCap) {
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      const vm = vAtG(mid);
      impliedG = mid;
      if (Math.abs(vm - marketCap) / Math.max(1, marketCap) < 0.001) break;
      if (vm < marketCap) lo = mid;
      else hi = mid;
    }
  }

  const vAtKe = (ket: number) => {
    if (ket <= g + 0.001) return Number.POSITIVE_INFINITY;
    const pv = periods.slice(1).reduce((acc, p, idx) => acc + (p.ri?.RE ?? 0) / Math.pow(1 + ket, idx + 1), 0);
    const cv = reAnchor * (1 + g) / (ket - g);
    return cse0 + pv + cv / Math.pow(1 + ket, explicitPeriods);
  };

  let impliedKe: number | null = null;
  let keLo = g + 0.005;
  let keHi = 0.25;
  if (vAtKe(keLo) >= marketCap) {
    for (let i = 0; i < 100; i++) {
      const mid = (keLo + keHi) / 2;
      const vm = vAtKe(mid);
      impliedKe = mid;
      if (Math.abs(vm - marketCap) / Math.max(1, marketCap) < 0.001) break;
      if (vm > marketCap) keLo = mid;
      else keHi = mid;
    }
  }

  return {
    status: "full" as const,
    shares,
    sharesSource,
    intrinsic,
    marketPrice,
    marketCap,
    mos,
    impliedG,
    impliedKe,
  };
}

export function computeNoaDiagnostics(data: RecastPeriod[]) {
  return data.map((d) => ({
    period: d.period_end,
    noa: d.bs.NOA,
    sales: d.is.Sales,
    noaToSales: d.is.Sales > 0 ? Math.abs(d.bs.NOA) / d.is.Sales : null,
    flagged: d.is.Sales > 0 ? Math.abs(d.bs.NOA) < 0.1 * d.is.Sales : false,
    indAs116Era: Number.parseInt(d.period_end.slice(0, 4), 10) >= 2020,
  }));
}

export function computeNoaShiftSeries(data: RecastPeriod[]) {
  return data.slice(1).map((d, idx) => {
    const prev = data[idx]!;
    return {
      period: d.period_end,
      deltaNOA: d.bs.NOA - prev.bs.NOA,
      deltaOA: d.bs.OA - prev.bs.OA,
      deltaFA: d.bs.FA - prev.bs.FA,
      deltaOL: d.bs.OL - prev.bs.OL,
      deltaFO: d.bs.FO - prev.bs.FO,
    };
  });
}

export function computePeriodDiagnostics(data: RecastPeriod[]) {
  return data.slice(1).map((d, idx) => {
    const prev = data[idx]!;
    const ds = (d.bs.CSE - prev.bs.CSE) - d.is.CNI + d.cf.d_t;
    const dsWarnThreshold = Math.max(0.05 * prev.bs.CSE, 0.03 * prev.bs.TA);
    const dsCritical = Math.abs(ds) > 0.1 * prev.bs.CSE;
    const dsWarn = Math.abs(ds) > dsWarnThreshold;
    const dDisc = d.cf.d_t_discrepancy;
    const capitalTxLikely = Math.abs(dDisc) > Math.max(Math.abs(d.is.CNI) * 0.2, 0.05 * prev.bs.CSE);
    const pmHist = data.slice(0, idx + 1).map((p) => p.ratios?.PM).filter((v): v is number => v != null);
    const pmMed = median(pmHist) ?? 0;
    const pmSigma = madSigma(pmHist);
    const pmZ = pmSigma > 0 ? ((d.ratios?.PM ?? 0) - pmMed) / pmSigma : 0;
    const largeComponentDecline = (
      (d.bs.OA - prev.bs.OA < -0.15 * prev.bs.OA && Math.abs(d.bs.OA - prev.bs.OA) > 0.02 * prev.bs.TA)
      || (d.bs.FA - prev.bs.FA < -0.15 * prev.bs.FA && Math.abs(d.bs.FA - prev.bs.FA) > 0.02 * prev.bs.TA)
      || (d.bs.OL - prev.bs.OL < -0.15 * prev.bs.OL && Math.abs(d.bs.OL - prev.bs.OL) > 0.02 * prev.bs.TA)
      || (d.bs.FO - prev.bs.FO < -0.15 * prev.bs.FO && Math.abs(d.bs.FO - prev.bs.FO) > 0.02 * prev.bs.TA)
    );
    const flags: string[] = [];
    if (dsCritical) flags.push("STRUCTURAL_EVENT_CRITICAL");
    else if (dsWarn) flags.push("STRUCTURAL_EVENT");
    if (capitalTxLikely) flags.push("CAPITAL_TRANSACTION_LIKELY");
    if (Math.abs(pmZ) > 3) flags.push("PM_OUTLIER_CRITICAL");
    else if (Math.abs(pmZ) > 2) flags.push("PM_OUTLIER_WARNING");
    if (largeComponentDecline) flags.push("LARGE_COMPONENT_DECLINE");
    return { period: d.period_end, ds, dDisc, pmZ, flags };
  });
}

export function computeRatioTimeline(
  data: RecastPeriod[],
  periodDiagnostics: ReturnType<typeof computePeriodDiagnostics>,
) {
  return data.map((d) => ({
    period: d.period_end,
    PM: d.ratios?.PM ?? null,
    ROCE: d.ratios?.ROCE ?? null,
    FLEV: d.ratios?.FLEV ?? null,
    payout: d.is.CNI !== 0 ? d.cf.DividendPaid / d.is.CNI : null,
    flags: periodDiagnostics.find((x) => x.period === d.period_end)?.flags ?? [],
  }));
}
