import { RawPeriodData, RecastPeriod } from "../../engine/types";

export function MethodologySection(props: {
  rawData: RawPeriodData[] | null | undefined;
  data: RecastPeriod[];
  eqROCE: string;
  eqRNOA: string;
  eqRE: string;
  eqReOI: string;
}) {
  const { rawData, data, eqROCE, eqRNOA, eqRE, eqReOI } = props;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">2) Methodology — Nissim & Penman (2001) Framework</h2>
        <div className="text-sm text-slate-700 space-y-4">
          <div>
            <h3 className="font-semibold text-slate-800 mb-1">2.1 Operating / Financing Separation</h3>
            <p>
              The engine implements the N&amp;P (2001) separation of all assets and liabilities into operating (OA, OL)
              and financing (FA, FO) categories. Financial assets include cash, short-term investments, long-term
              investments, deposits, and interest/dividend receivables. Financial obligations include all borrowings,
              lease liabilities (Ind AS 116), hybrid perpetual securities (when classified as debt per user config),
              and other financial liabilities. Operating assets (OA = TA − FA) and operating liabilities (OL =
              TotalLiabilities − FO) are derived by difference. All identities are enforced: NOA = OA − OL =
              CSE + MI + NFO; OI = CNI + NFE + MII. The separation confidence score (0–100) reflects how many
              granular sub-components were successfully mapped vs. derived by difference.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 mb-1">2.2 India-Specific Adjustments (Ind AS)</h3>
            <p>
              (a) <b>Ind AS 116 Leases:</b> Right-of-use assets and lease liabilities are automatically included in
              OA and FO respectively (effective from FY2020 for listed Indian entities). This increases both NOA and
              NFO relative to pre-Ind AS 116 periods, creating a time-series discontinuity. The engine flags this.
            </p>
            <p className="mt-1">
              (b) <b>Deferred Tax:</b> DTL is classified within OL; DTA in OA. The engine provides a DTA/DTL flag
              when DTA exceeds 3% of TA.
            </p>
            <p className="mt-1">
              (c) <b>Exceptional Items:</b> Ind AS does not permit "exceptional items below the line" (unlike old
              Indian GAAP). The engine classifies pre-tax exceptional items tagged in Capitaline as UOI
              (Unusual OI), taxed at the effective rate, and excludes them from Core OI.
            </p>
            <p className="mt-1">
              (c.1) <b>Formal unusual-item policy:</b> unusual items are now bucketed into exceptional operating items,
              discontinued operations, OCI reclassifications, unusual financing items, and capital-transaction signals.
              That policy determines whether an item is excluded from Core OI, excluded from Core NFE, or treated as
              a terminal-valuation blocker.
            </p>
            <p className="mt-1">
              (d) <b>OCI Treatment:</b> Under current config, OCI is treated as unusual and excluded from Core OI.
              This is configurable. For companies with significant actuarial gains/losses or fair-value changes,
              treating OCI as operating may be more appropriate.
            </p>
            <p className="mt-1">
              (e) <b>No LIFO:</b> Indian GAAP and Ind AS do not permit LIFO inventory costing. The LIFO reserve
              adjustment that US-focused N&amp;P analyses apply is inapplicable here; LIFO_reserve = 0 throughout.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 mb-1">2.3 Profitability Decomposition (Eq.1–16)</h3>
            <p>
              The engine implements the full N&amp;P profitability bridge. ROCE = RNOA + FLEV × SPREAD
              (Eq. 4/5, N&amp;P 2001). Operating profitability decomposes as RNOA = PM × ATO (Eq. 7/8).
              Operating liability leverage adds: RNOA = ROOA + OLLEV × OLSPREAD (Eq. 11, N&amp;P 2001).
              The full Eq. 16 bridge decomposes ROCE into: CoreSalesPM × ATO + CoreOtherItems/NOA +
              UOI/NOA + OLLEV × OLSPREAD + FLEV × CoreSPREAD + FLEV × (UOI/NOA − UFE/NFO).
              The reconstruction residual (ROCE − ROCE_eq16) quantifies the bridge closure error.
            </p>
            <p className="mt-1">
              The forecast layer now also carries a detailed operating-cost bridge from sales through material cost,
              employee cost, depreciation, SG&amp;A, other operating expense, and other operating income. When that
              bridge has enough coverage, forward Core OI is built from those drivers instead of a single black-box margin.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 mb-1">2.4 Valuation Models</h3>
            <p>
              <b>RE model (Eq. 1a):</b> V = CSE₀ + Σ PV(RE_t) + PV(CV_RE), where RE_t = CNI_t − k_e × CSE_(t-1).
              Three continuing values: CV1 (zero), CV2 (perpetuity), CV3 (Gordon growth at rate g).
            </p>
            <p className="mt-1">
              <b>ReOI model (Eq. 9):</b> EV = NOA₀ + Σ PV(ReOI_t) + PV(CV_ReOI), where ReOI_t = OI_t − k_w × NOA_(t-1).
              Equity value = EV − NFO_latest. Preferred when FA/FO separation is reliable.
            </p>
            <p className="mt-1">
              <b>FCFF/FCFE:</b> FCFF_t = NOPAT_t − ΔNOA_t; FCFE_t = CNI_t − ΔCSE_t. Discounted at k_w and k_e
              respectively. Under clean-surplus and consistent assumptions, FCFF converges with ReOI (algebraic identity).
            </p>
            <p className="mt-1">
              <b>AEG (Ohlson-Juettner 2005):</b> Short-cut proxy: V = CNI₁/k_e + Σ PV(AEG_t),
              where AEG_t = CNI_t − ρ_e × CNI_(t-1). This implements the historical-data version of the OJ model.
            </p>
            <p className="mt-1">
              <b>Reverse DCF:</b> Bisection search over the RE Gordon CV formula to back-solve for the growth rate
              g* implied by the entered market capitalisation (market_price × shares_outstanding).
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 mb-1">2.5 Forecasting (Fade Analysis)</h3>
            <p>
              Forecast drivers (Sales growth, Core PM, ATO, FLEV, NBC) are faded from their latest historical values
              toward N&amp;P (2001) Table 1 long-run medians using AR(1) fade parameters from N&amp;P Table 3:
              FADE_CoreSalesPM = 0.87, FADE_ATO = 0.95, FADE_Sales_growth = 0.70. Bull/Bear scenarios scale
              drivers proportionally. Probability-weighted expected value uses entered scenario probabilities. Compare this mechanical fade with the observed PM trajectory in Section 5B before finalizing valuation anchors.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 mb-1">2.6 Data Source Mapping</h3>
            <p>
              This analysis used {rawData ? `${rawData.length} period(s) of data` : "uploaded financial data"}
              processed through the Capitaline Ind AS CSV parser with 350+ line-item mapping rules.
              The Provenance Audit tab lists every canonical variable with its source mapping, match type
              (exact/fuzzy/derived), and value. The separation confidence score is{" "}
              {data.length > 0 ? `${data[data.length - 1]!.bs.separationScore}/100` : "—"}.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Core Equations (N&amp;P 2001)</div>
            <div dangerouslySetInnerHTML={{ __html: eqROCE }} className="mb-2" />
            <div dangerouslySetInnerHTML={{ __html: eqRNOA }} />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Residual Income Definitions</div>
            <div dangerouslySetInnerHTML={{ __html: eqRE }} className="mb-2" />
            <div dangerouslySetInnerHTML={{ __html: eqReOI }} />
          </div>
        </div>
      </section>
  );
}
