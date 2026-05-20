/**
 * NSE Symbol Registry
 *
 * Maps company folder names (as used in public/data/companies/) to NSE ticker symbols.
 * Used by the market data hook to auto-resolve symbols when provider is "nse".
 */

export const NSE_SYMBOL_REGISTRY: Record<string, string> = {
  "ITC": "ITC",
  "Reliance Industries": "RELIANCE",
  "HDFC Bank": "HDFCBANK",
  "ICICI Bank": "ICICIBANK",
  "SBIN": "SBIN",
  "KOTAKBANK": "KOTAKBANK",
  "Tata Consultancy Services Ltd": "TCS",
  "Tata Steel": "TATASTEEL",
  "Bajaj Finance": "BAJFINANCE",
  "Power Grid Corporation of India Ltd": "POWERGRID",
  "Life Insurance Corporation of India": "LICI",
  "Paytm": "PAYTM",
  "Vodafone Idea Ltd": "IDEA",
};

/**
 * Resolve NSE symbol from a company name/folder.
 * Tries exact match first, then case-insensitive partial match.
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

// If the input is a known NSE symbol (exists as a value in the registry), pass through
const knownSymbols = Object.values(NSE_SYMBOL_REGISTRY);
if (knownSymbols.includes(companyNameOrFolder)) {
return companyNameOrFolder;
}

// Deprecated: all-caps passthrough removed — invalid symbols like
// "BAJAJFINANCE" (not a real NSE ticker) silently passed through
// and caused NSE API failures. Only known symbols pass through now.
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

  // Fallback: try case-insensitive match on keys (handles folder name mismatches)
  for (const [key,] of Object.entries(NSE_SYMBOL_REGISTRY)) {
    if (key.toLowerCase().replace(/ /g, '') === symbol.toLowerCase().replace(/ /g, '')) {
      return key;
    }
  }

  // Fallback to exact symbol name if not in registry
  return symbol;
}

