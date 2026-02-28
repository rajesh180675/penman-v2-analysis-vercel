import { EngineConfig, MultiCompanyRecord, RawPeriodData } from "./types";
import { processCompanyData } from "./pipeline";

export function processMultiCompany(
  datasets: Array<{ id: string; label: string; rawData: RawPeriodData[] }>,
  config: EngineConfig,
): Record<string, MultiCompanyRecord> {
  const out: Record<string, MultiCompanyRecord> = {};
  for (const ds of datasets) {
    out[ds.id] = {
      id: ds.id,
      label: ds.label,
      rawData: ds.rawData,
      recastData: processCompanyData(ds.rawData, config),
    };
  }
  return out;
}
