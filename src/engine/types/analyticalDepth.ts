/* Pure type leaf — analyticalDepth envelope block (Plan 5 keystone, schema v18).

   The structural trust blocks (parserFidelity, reconciliation, …) say whether
   the DATA can be trusted. This block says how much ANALYTICAL DEPTH the
   valuation actually exercised — was a reverse-DCF expectation plausible, did
   clean-surplus hold, did the independent Damodaran CAPM cross-check agree with
   the model ke, was a SOTP run. The four analytics already exist in
   ValuationCommandCenterOutput; this block surfaces them in the shared envelope.

   Mirrors the shape of the other blocks (status enum + summary + counts +
   checks[]) so consumers and the trust panel read it uniformly. Contains ONLY
   types — no runtime values — and imports nothing, keeping it a pure leaf. */

export type AnalyticalDepthStatus = "rich" | "partial" | "absent";

export type AnalyticalDepthCheckStatus = "ok" | "watch" | "n/a";

export type AnalyticalDepthCheckKey =
  | "reverse-dcf"
  | "clean-surplus"
  | "damodaran-capm"
  | "sotp";

export interface AnalyticalDepthCheck {
  key: AnalyticalDepthCheckKey;
  label: string;
  /** Was this analytic actually computed for the run? */
  present: boolean;
  /** "ok" = present and within expectation; "watch" = present but flagged
   *  (e.g. implausible reverse-DCF expectation, material dirty surplus, ke
   *  disagreement); "n/a" = analytic absent. */
  status: AnalyticalDepthCheckStatus;
  detail: string;
}

export interface AnalyticalDepthSummary {
  /** Roll-up: "rich" = all 4 present; "partial" = 1–3 present; "absent" = none. */
  status: AnalyticalDepthStatus;
  summary: string;
  /** Count of the 4 depth analytics that were computed. */
  presentCount: number;
  /** Count of present analytics flagged "watch". */
  watchCount: number;
  checks: AnalyticalDepthCheck[];
}
