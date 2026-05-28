/**
 * NSE Symbol Registry — GENERATED FROM registry.json
 *
 * DO NOT EDIT BY HAND. Run `node scripts/sync-tickers.cjs` after
 * modifying public/data/companies/registry.json.
 *
 * Maps company folder names (as used in public/data/companies/) to NSE
 * ticker symbols. Used by the market data hook to auto-resolve symbols
 * when provider is "nse".
 *
 * Phase rigor-4 (May 2026): registry.json is now the single source of
 * truth for tickers. This file is a derived artifact.
 */

export const NSE_SYMBOL_REGISTRY: Record<string, string> = {
  "Asian Paints": "ASIANPAINT",
  "Avenue Supermarts": "DMART",
  "Bajaj Finance": "BAJFINANCE",
  "Bharti Airtel": "BHARTIARTL",
  "Britannia Industries": "BRITANNIA",
  "Cholamandalam Investment": "CHOLAFIN",
  "Dabur India": "DABUR",
  "Grasim Industries": "GRASIM",
  "HDFC Bank": "HDFCBANK",
  "Hindustan Unilever": "HINDUNILVR",
  "ICICI Bank": "ICICIBANK",
  "Infosys": "INFY",
  "ITC": "ITC",
  "KOTAKBANK": "KOTAKBANK",
  "Larsen & Toubro Ltd": "LT",
  "Life Insurance Corporation of India": "LICI",
  "Mahindra & Mahindra": "M&M",
  "Maruti Suzuki India Ltd": "MARUTI",
  "Muthoot Finance": "MUTHOOTFIN",
  "Nestlé India": "NESTLEIND",
  "NTPC": "NTPC",
  "Paytm": "PAYTM",
  "Power Grid Corporation of India Ltd": "POWERGRID",
  "Reliance Industries": "RELIANCE",
  "SBIN": "SBIN",
  "Shriram Finance": "SHRIRAMFINAN",
  "Sun Pharmaceutical Industries Ltd": "SUNPHARMA",
  "Tata Consultancy Services Ltd": "TCS",
  "Tata Steel": "TATASTEEL",
  "Titan Company": "TITAN",
  "UltraTech Cement Ltd": "ULTRACEMCO",
  "Vodafone Idea Ltd": "IDEA",
};

/**
 * Resolve NSE symbol from a company name/folder.
 * Tries exact match first, then case-insensitive, then partial.
 */
export function resolveNseSymbol(companyNameOrFolder: string | null | undefined): string | null {
  if (!companyNameOrFolder) return null;

  // Exact match
  if (companyNameOrFolder in NSE_SYMBOL_REGISTRY) {
    return NSE_SYMBOL_REGISTRY[companyNameOrFolder];
  }

  // Case-insensitive match
  const lower = companyNameOrFolder.toLowerCase();
  for (const [key, symbol] of Object.entries(NSE_SYMBOL_REGISTRY)) {
    if (key.toLowerCase() === lower) return symbol;
  }

  // Partial match (company name contains key or vice versa)
  for (const [key, symbol] of Object.entries(NSE_SYMBOL_REGISTRY)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return symbol;
    }
  }

  // If the input is itself a known NSE symbol, pass through
  const knownSymbols = Object.values(NSE_SYMBOL_REGISTRY);
  if (knownSymbols.includes(companyNameOrFolder.toUpperCase())) {
    return companyNameOrFolder.toUpperCase();
  }

  return null;
}

/**
 * Resolve the original company folder name given an NSE symbol.
 * Used to find the matching public/data/companies/ directory name.
 */
export function resolveFolderFromSymbol(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  const upper = symbol.toUpperCase();

  // Try to find the exact match in registry values
  for (const [key, val] of Object.entries(NSE_SYMBOL_REGISTRY)) {
    if (val.toUpperCase() === upper) {
      return key;
    }
  }

  // Fallback: case-insensitive whitespace-stripped match on keys
  for (const [key] of Object.entries(NSE_SYMBOL_REGISTRY)) {
    if (key.toLowerCase().replace(/ /g, "") === symbol.toLowerCase().replace(/ /g, "")) {
      return key;
    }
  }

  // Fallback to the input symbol if nothing matched
  return symbol;
}
