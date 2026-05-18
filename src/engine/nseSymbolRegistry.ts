/**
 * NSE Symbol Registry
 *
 * Maps company folder names (as used in public/data/companies/) to NSE ticker symbols.
 * Used by the market data hook to auto-resolve symbols when provider is "nse".
 */

export const NSE_SYMBOL_REGISTRY: Record<string, string> = {
  "ITC": "ITC",
  "reliance Industries": "RELIANCE",
  "HDFC bank": "HDFCBANK",
  "ICICI bank": "ICICIBANK",
  "SBIN": "SBIN",
  "KOTAKBANK": "KOTAKBANK",
  "Tata Consultancy Services Ltd": "TCS",
  "Tata steel": "TATASTEEL",
  "bajaj finance": "BAJFINANCE",
  "Power Grid Corporation of India Ltd": "POWERGRID",
  "Life Insurance Corporation of India": "LICI",
  "paytm": "PAYTM",
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

  // If the input looks like an NSE symbol already (all caps, no spaces), pass through
  if (/^[A-Z]{2,20}$/.test(companyNameOrFolder)) {
    return companyNameOrFolder;
  }

  return null;
}
