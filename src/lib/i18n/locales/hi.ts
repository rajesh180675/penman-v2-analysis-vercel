import type { LocaleDictionary } from "./en";

/* Hindi translations.
   Status: app + nav + common = professionally-translatable; valuation
   glossary is held back to English for reviewer credibility until
   sign-off from a finance-domain Hindi translator. Unset keys fall
   through to English via i18n.t().
*/
export const hi: Partial<LocaleDictionary> = {
  app: {
    title: "Penman V2 विश्लेषण",
    subtitle: "Rigor Ladder के माध्यम से रक्षात्मक मूल्यांकन",
  },
  nav: {
    valuation: "मूल्यांकन",
    forecast: "पूर्वानुमान",
    quality: "गुणवत्ता",
    ratios: "अनुपात",
    statements: "विवरण",
    regression: "रिग्रेशन",
    comparison: "तुलना",
    academicReport: "शैक्षिक रिपोर्ट",
    v3Analytics: "उन्नत विश्लेषण",
  },
  common: {
    save: "सहेजें",
    cancel: "रद्द करें",
    loading: "लोड हो रहा है...",
    error: "त्रुटि",
    confirm: "पुष्टि करें",
    delete: "हटाएं",
    export: "निर्यात",
    download: "डाउनलोड",
    refresh: "पुनः लोड",
    yes: "हाँ",
    no: "नहीं",
  },
};
