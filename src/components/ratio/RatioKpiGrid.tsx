import type { RecastPeriod } from "../../engine/types";
import KPITile from "../dashboard/KPITile";

interface Props {
  rd: RecastPeriod[];
  latest: RecastPeriod;
}

export function RatioKpiGrid({ rd, latest }: Props) {
  const previous = rd.length >= 2 ? rd[rd.length - 2]! : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
      <KPITile
        label="ROCE"
        value={latest.ratios?.ROCE ?? null}
        format="pct"
        history={rd.map(d => ({ period: d.period_end.slice(0, 4), value: d.ratios?.ROCE ?? null }))}
        trend={previous ? (latest.ratios?.ROCE ?? 0) - (previous.ratios?.ROCE ?? 0) : null}
      />
      <KPITile
        label="RNOA"
        value={latest.ratios?.RNOA ?? null}
        format="pct"
        history={rd.map(d => ({ period: d.period_end.slice(0, 4), value: d.ratios?.RNOA ?? null }))}
        trend={previous ? (latest.ratios?.RNOA ?? 0) - (previous.ratios?.RNOA ?? 0) : null}
      />
      <KPITile
        label="Profit Margin"
        value={latest.ratios?.PM ?? null}
        format="pct"
        history={rd.map(d => ({ period: d.period_end.slice(0, 4), value: d.ratios?.PM ?? null }))}
      />
      <KPITile
        label="Asset Turnover"
        value={latest.ratios?.ATO ?? null}
        format="mult"
        history={rd.map(d => ({ period: d.period_end.slice(0, 4), value: d.ratios?.ATO ?? null }))}
      />
      <KPITile
        label="Fin. Leverage"
        value={latest.ratios?.FLEV ?? null}
        format="mult"
        history={rd.map(d => ({ period: d.period_end.slice(0, 4), value: d.ratios?.FLEV ?? null }))}
      />
      <KPITile
        label="Cash Conversion"
        value={latest.ratios?.cash_conversion_ratio ?? null}
        format="mult"
        history={rd.map(d => ({ period: d.period_end.slice(0, 4), value: d.ratios?.cash_conversion_ratio ?? null }))}
      />
    </div>
  );
}
