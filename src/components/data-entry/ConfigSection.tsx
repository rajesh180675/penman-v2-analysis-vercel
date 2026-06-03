import { EngineConfig, validateEngineConfig } from "../../engine/types";
import { PercentFraction, CroreShares, INRAbsolute } from "../../engine/types/units";

interface Props {
  config: EngineConfig;
  onConfigChange: (cfg: EngineConfig) => void;
  typeNotSelected: boolean;
  configWarnings: ReturnType<typeof validateEngineConfig>;
  companyId: string;
  setCompanyId: React.Dispatch<React.SetStateAction<string>>;
  showAdvancedConfig: boolean;
  setShowAdvancedConfig: React.Dispatch<React.SetStateAction<boolean>>;
  showCostOfCapital: boolean;
  setShowCostOfCapital: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function ConfigSection({
  config,
  onConfigChange,
  typeNotSelected,
  configWarnings,
  companyId,
  setCompanyId,
  showAdvancedConfig,
  setShowAdvancedConfig,
  showCostOfCapital,
  setShowCostOfCapital,
}: Props) {
  return (
    <>
      {/* Config row — Essential (always visible) */}
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Company ID</label>
          <input value={companyId} onChange={(e) => setCompanyId(e.target.value.toUpperCase())}
            className="w-24 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" placeholder="VST" />
        </div>
        <div>
          <label className={`block text-xs font-semibold mb-1 ${typeNotSelected ? "text-red-600" : "text-slate-600"}`}>
            Company Type{typeNotSelected && <span className="ml-1 text-red-600">⛔ required</span>}
          </label>
          <select
            value={config.company_type ?? "auto"}
            onChange={(e) => onConfigChange({
              ...config,
              company_type: e.target.value as EngineConfig["company_type"],
            })}
            className={`px-3 py-1.5 border rounded-lg text-sm bg-white ${
              typeNotSelected
                ? "border-red-400 ring-1 ring-red-400"
                : "border-slate-300"
            }`}
          >
            <option value="auto" disabled>— Select type —</option>
            <option value="bank">Bank</option>
            <option value="nbfc">NBFC</option>
            <option value="insurance">Insurance</option>
            <option value="industrial">Industrial</option>
            <option value="it-services">IT Services</option>
            <option value="consumer">Consumer / FMCG</option>
            <option value="utility">Utility / PSU</option>
            <option value="telecom">Telecom</option>
            <option value="cyclical">Cyclical / Metals</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Market Price ₹</label>
          <input
            type="number"
            step={0.01}
            value={config.market_price ?? ""}
            onChange={(e) => {
              const value = e.target.value.trim();
              onConfigChange({ ...config, market_price: value ? INRAbsolute(Number(value)) : undefined });
            }}
            className="w-28 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
            placeholder="₹"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Shares (Cr)</label>
          <input
            type="number"
            step={0.01}
            value={config.shares_outstanding ?? ""}
            onChange={(e) => {
              const value = e.target.value.trim();
              onConfigChange({ ...config, shares_outstanding: value ? CroreShares(Number(value)) : undefined });
            }}
            className="w-28 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
            placeholder="auto if blank"
          />
        </div>
      </div>

      {/* Fix 10: Config validation warnings — shown inline below essential fields */}
      {configWarnings.length > 0 && (
        <div className="mx-6 mb-2 space-y-1">
          {configWarnings.map((w, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                w.severity === "error"
                  ? "bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300"
                  : "bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300"
              }`}
            >
              <span className="mt-0.5 shrink-0">{w.severity === "error" ? "⛔" : "⚠️"}</span>
              <span><b>{w.field}:</b> {w.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Collapsible: Advanced Config */}
      <div className="border-b border-slate-100">
        <button
          onClick={() => setShowAdvancedConfig(!showAdvancedConfig)}
          className="w-full px-6 py-2.5 flex items-center justify-between text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <span>▸ Advanced Configuration (sector, market data, tax)</span>
          <span className="text-slate-400">{showAdvancedConfig ? "▾" : "▸"}</span>
        </button>
        {showAdvancedConfig && (
          <div className="px-6 py-4 bg-slate-50 flex flex-wrap gap-4 items-end border-t border-slate-100">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Market Symbol</label>
              <input
                value={config.market_data_symbol ?? config.ticker ?? ""}
                onChange={(e) => onConfigChange({ ...config, market_data_symbol: e.target.value.toUpperCase().trim() || undefined })}
                className="w-36 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                placeholder="ASIANPAINT.BSE"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">DCF Sector Template</label>
              <select
                value={config.sector_template ?? "auto"}
                onChange={(e) => onConfigChange({
                  ...config,
                  sector_template: e.target.value as EngineConfig["sector_template"],
                })}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="auto" disabled>— Select type —</option>
                <option value="consumer-staples">Consumer staples</option>
                <option value="paint">Paint / coatings</option>
                <option value="industrials">Industrials</option>
                <option value="commodities">Commodities</option>
                <option value="retail">Retail</option>
                <option value="services">Services</option>
                <option value="telecom">Telecom / spectrum network</option>
                <option value="utility">Utility / regulated asset base</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Market Data Mode</label>
              <select
                value={config.market_data_provider ?? "manual"}
                onChange={(e) => onConfigChange({
                  ...config,
                  market_data_provider: e.target.value as EngineConfig["market_data_provider"],
                })}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="manual">Manual / Fallback</option>
                <option value="upstox-readonly">Upstox Read-only</option>
                <option value="alphavantage">Alpha Vantage</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
            {(config.market_data_provider ?? "manual") === "upstox-readonly" && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Upstox Instrument Key</label>
                <input
                  value={config.market_data_instrument_key ?? ""}
                  onChange={(e) => onConfigChange({ ...config, market_data_instrument_key: e.target.value.trim() || undefined })}
                  className="w-52 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                  placeholder="NSE_EQ|INE021A01026"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Risk-Free Rate %</label>
              <input type="number" step={0.5} value={(config.risk_free_rate * 100).toFixed(1)}
                onChange={(e) => onConfigChange({ ...config, risk_free_rate: Number(e.target.value) / 100 })}
                className="w-24 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tax Rate Mode</label>
              <select value={config.tax_rate_mode}
                onChange={(e) => onConfigChange({ ...config, tax_rate_mode: e.target.value as "effective" | "statutory" })}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
                <option value="effective">Effective</option>
                <option value="statutory">Statutory (25.17%)</option>
              </select>
            </div>
            <div className="flex gap-3 flex-wrap items-center">
              {[
                { key: "oci_treated_as_unusual" as const, label: "OCI = Unusual" },
                { key: "financial_institution_mode" as const, label: "Fin Institution (blocked)" },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={config[key] as boolean}
                    onChange={(e) => onConfigChange({ ...config, [key]: e.target.checked })}
                    className="rounded" />
                  {label}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Collapsible: Cost of Capital */}
      <div className="border-b border-slate-100">
        <button
          onClick={() => setShowCostOfCapital(!showCostOfCapital)}
          className="w-full px-6 py-2.5 flex items-center justify-between text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors"
        >
          <span>▸ Cost of Capital (ke, kd, WACC)</span>
          <span className="text-blue-400">{showCostOfCapital ? "▾" : "▸"}</span>
        </button>
        {showCostOfCapital && (
        <div className="px-6 py-3 bg-blue-50 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-blue-700 mb-1">
              ke — Cost of Equity %
              <span className="text-blue-400 ml-1">(0 = use rf+erp)</span>
            </label>
            <input type="number" step={0.5} min={0} max={50}
              value={config.ke > 0 ? (config.ke * 100).toFixed(1) : ""}
              placeholder={`${((config.risk_free_rate + config.equity_risk_premium) * 100).toFixed(1)}`}
              onChange={(e) => {
                const v = Number(e.target.value);
                onConfigChange({ ...config, ke: PercentFraction(v > 0 ? v / 100 : 0) });
              }}
              className="w-28 px-3 py-1.5 border border-blue-300 rounded-lg text-sm bg-white" />
          </div>
          <div>
            <label className="block text-xs font-medium text-blue-700 mb-1">kd pre-tax %</label>
            <input type="number" step={0.25} min={0} max={30}
              value={(config.kd_pretax * 100).toFixed(2)}
              onChange={(e) => onConfigChange({ ...config, kd_pretax: Number(e.target.value) / 100 })}
              className="w-28 px-3 py-1.5 border border-blue-300 rounded-lg text-sm bg-white" />
          </div>
          <div>
            <label className="block text-xs font-medium text-blue-700 mb-1">Tax rate for kd %</label>
            <input type="number" step={0.5} min={0} max={50}
              value={(config.tax_rate_for_kd * 100).toFixed(2)}
              onChange={(e) => onConfigChange({ ...config, tax_rate_for_kd: Number(e.target.value) / 100 })}
              className="w-28 px-3 py-1.5 border border-blue-300 rounded-lg text-sm bg-white" />
          </div>
          <div className="text-xs text-blue-600 bg-white rounded-lg border border-blue-200 px-3 py-2">
            kd after-tax = kd_pretax × (1 − τ_kd)<br />
            = <b>{((config.kd_pretax * (1 - config.tax_rate_for_kd)) * 100).toFixed(2)}%</b>
            &nbsp;(computed, not stored)
          </div>
        </div>
        )}
      </div>
    </>
  );
}
