/* English (canonical). All other locales inherit unspecified keys
   from this file via the t() fallback. */

export interface LocaleDictionary {
  app: {
    title: string;
    subtitle: string;
  };
  nav: {
    valuation: string;
    forecast: string;
    quality: string;
    ratios: string;
    statements: string;
    regression: string;
    comparison: string;
    academicReport: string;
    v3Analytics: string;
  };
  common: {
    save: string;
    cancel: string;
    loading: string;
    error: string;
    confirm: string;
    delete: string;
    export: string;
    download: string;
    refresh: string;
    yes: string;
    no: string;
  };
  rigor: {
    syntacticallyValid: string;
    structurallyReconciled: string;
    economicallyPlausible: string;
    valuationEligible: string;
    productionReady: string;
  };
  valuation: {
    intrinsicValue: string;
    marketPrice: string;
    upside: string;
    costOfEquity: string;
    costOfDebt: string;
    wacc: string;
    impliedGrowth: string;
    terminalGrowth: string;
  };
}

export const en: LocaleDictionary = {
  app: {
    title: "Penman V2 Analysis",
    subtitle: "Defensible valuation runs through the rigor ladder",
  },
  nav: {
    valuation: "Valuation",
    forecast: "Forecast",
    quality: "Quality",
    ratios: "Ratios",
    statements: "Statements",
    regression: "Regression",
    comparison: "Comparison",
    academicReport: "Academic Report",
    v3Analytics: "Advanced Analytics",
  },
  common: {
    save: "Save",
    cancel: "Cancel",
    loading: "Loading...",
    error: "Error",
    confirm: "Confirm",
    delete: "Delete",
    export: "Export",
    download: "Download",
    refresh: "Refresh",
    yes: "Yes",
    no: "No",
  },
  rigor: {
    syntacticallyValid: "Syntactically Valid",
    structurallyReconciled: "Structurally Reconciled",
    economicallyPlausible: "Economically Plausible",
    valuationEligible: "Valuation Eligible",
    productionReady: "Production Ready",
  },
  valuation: {
    intrinsicValue: "Intrinsic Value",
    marketPrice: "Market Price",
    upside: "Upside",
    costOfEquity: "Cost of Equity",
    costOfDebt: "Cost of Debt",
    wacc: "WACC",
    impliedGrowth: "Implied Growth",
    terminalGrowth: "Terminal Growth",
  },
};
