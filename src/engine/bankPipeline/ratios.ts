import { FinancialInstitutionSubtype } from "../analysisFamily";
import { ScopeAssessment } from "../scopePolicy";
import { BankPeriodMetrics, avg, sumStrict, sumLenient } from "./metrics";

// ─── Ratio Computation ──────────────────────────────────────────────────────

export function computeBankRatios(
  current: BankPeriodMetrics,
  prev: BankPeriodMetrics | null,
  subtype: FinancialInstitutionSubtype = "bank",
): BankPeriodMetrics {
  const result = { ...current };
  // Phase K — NBFC framing: NIM denominator is advances-only (no SLR
  // investments to dilute it), and we surface yield/cost/spread instead
  // of NIM-on-earning-assets which is a bank framing.
  const isNbfcFraming = subtype === "nbfc" || subtype === "generic-financial";

  // Phase D — NBFC borrowings fallback: Capitaline Ind-AS for NBFCs often
  // has no explicit "Borrowings" line item, embedding them in totals only.
  // For NBFCs, virtually all liabilities are borrowings (no retail deposits),
  // so totalAssets − totalEquity is a sound proxy for total borrowings.
  if (isNbfcFraming && result.borrowings == null && result.totalAssets != null && result.totalEquity != null) {
    result.borrowings = result.totalAssets - result.totalEquity;
  }

  if (prev) {
    const avgAssets   = avg(current.totalAssets,  prev.totalAssets);
    const avgEquity   = avg(current.totalEquity,  prev.totalEquity);
    const avgAdvances = avg(current.advances,     prev.advances);

    // M4: apply the same NBFC borrowings fallback to prev so avgBorrowings
    // is consistent — using result.borrowings (fallback-applied) vs raw
    // prev.borrowings produced an asymmetric average for the first NBFC period.
    let prevBorrowings = prev.borrowings;
    if (isNbfcFraming && prevBorrowings == null && prev.totalAssets != null && prev.totalEquity != null) {
      prevBorrowings = prev.totalAssets - prev.totalEquity;
    }
    const avgBorrowings = avg(result.borrowings, prevBorrowings);
    // Earning assets: advances + investments for banks, advances-only for NBFCs.
    const earningAssets = isNbfcFraming
      ? avgAdvances
      : avg(
          sumStrict(current.advances, current.investments),
          sumStrict(prev.advances,    prev.investments),
        );

    // NIM = NII / Average Earning Assets — skip for insurance (premium ≠ interest)
    if (subtype !== "insurance" && current.nii != null && earningAssets != null && earningAssets > 0) {
      result.nim = current.nii / earningAssets;
    }

    // ROA = PAT / Average Total Assets (meaningful for all subtypes incl. insurance)
    if (current.pat != null && avgAssets != null && avgAssets > 0) {
      result.roa = current.pat / avgAssets;
    }

    // ROE = PAT / Average Equity (meaningful for all subtypes incl. insurance)
    if (current.pat != null && avgEquity != null && avgEquity > 0) {
      result.roe = current.pat / avgEquity;
    }

    // Credit Cost = Provisions / Average Advances — skip for insurance (no loan book)
    if (subtype !== "insurance" && current.provisions != null && avgAdvances != null && avgAdvances > 0) {
      result.creditCost = Math.abs(current.provisions) / avgAdvances;
    }

    // Phase K — NBFC: yield on advances, cost of borrowings, spread
    if (isNbfcFraming) {
      if (current.interestEarned != null && avgAdvances != null && avgAdvances > 0) {
        result.yieldOnAdvances = current.interestEarned / avgAdvances;
      }
      if (current.interestExpended != null && avgBorrowings != null && avgBorrowings > 0) {
        result.costOfBorrowings = Math.abs(current.interestExpended) / avgBorrowings;
      }
      if (result.yieldOnAdvances != null && result.costOfBorrowings != null) {
        result.spread = result.yieldOnAdvances - result.costOfBorrowings;
      }
    }
  }

  // Cost to Income = Operating Expenses / (NII + Other Income)
  // Skip for insurance — NII is not meaningful; use expenseRatio instead.
  if (subtype !== "insurance") {
    const totalIncome = sumLenient(current.nii, current.otherIncome);
    if (current.operatingExpenses != null && totalIncome != null && totalIncome > 0) {
      result.costToIncome = Math.abs(current.operatingExpenses) / totalIncome;
    }
  }

  // Phase K — NBFC: leverage and debt mix (point-in-time, no averaging needed)
  if (isNbfcFraming) {
    // Leverage = Total Borrowings / Total Equity. Standard NBFC gearing
    // metric. Banks fund through deposits so this number isn't comparable.
    if (result.borrowings != null && result.totalEquity != null && result.totalEquity > 0) {
      result.leverage = result.borrowings / result.totalEquity;
    }

    // Debt mix: fractions of total borrowings. Sum may be < 1 because
    // Capitaline doesn't break out commercial paper / FCNRB borrowings
    // separately — the residual is informational, not a parser bug.
    if (result.borrowings != null && result.borrowings > 0) {
      const safeShare = (component: number | null): number | null =>
        component != null ? component / result.borrowings! : null;
      result.debtMix = {
        ncdShare: safeShare(current.nonConvertibleDebentures),
        bankLoanShare: safeShare(current.termLoansFromBanks),
        institutionLoanShare: safeShare(current.termLoansFromInstitutions),
        otherLoanShare: safeShare(current.termLoansFromOthers),
      };
    }
  }

  // Insurance specific ratio calculations
  if (subtype === "insurance") {
    if (result.premiumEarned != null && result.premiumEarned > 0) {
      if (result.claimsExpense != null) {
        result.claimsRatio = Math.abs(result.claimsExpense) / result.premiumEarned;
      }
      if (result.operatingExpenses != null) {
        result.expenseRatio = Math.abs(result.operatingExpenses) / result.premiumEarned;
      }
      if (result.claimsRatio != null && result.expenseRatio != null) {
        result.combinedRatio = result.claimsRatio + result.expenseRatio;
      }
    }
    if (result.policyholderFunds != null && result.totalEquity != null && result.totalEquity > 0) {
      result.floatToEquity = result.policyholderFunds / result.totalEquity;
    } else if (result.totalAssets != null && result.totalEquity != null && result.totalEquity > 0) {
      result.floatToEquity = (result.totalAssets - result.totalEquity) / result.totalEquity;
    }

    if (prev) {
      if (current.premiumEarned != null && prev.premiumEarned != null && prev.premiumEarned > 0) {
        result.premiumGrowth = (current.premiumEarned - prev.premiumEarned) / prev.premiumEarned;
      }

      const currInvest = current.policyholderFunds ?? (current.totalAssets != null && current.totalEquity != null ? current.totalAssets - current.totalEquity : null);
      const prevInvest = prev.policyholderFunds ?? (prev.totalAssets != null && prev.totalEquity != null ? prev.totalAssets - prev.totalEquity : null);
      const avgInvest = avg(currInvest, prevInvest);
      if (current.investmentIncome != null && avgInvest != null && avgInvest > 0) {
        result.investmentYield = current.investmentIncome / avgInvest;
      }
    }
  }

  return result;
}

// ─── Subtype Detection ──────────────────────────────────────────────────────

export function detectSubtype(scope: ScopeAssessment, configHint?: string): FinancialInstitutionSubtype {
  // If config explicitly declares bank/nbfc/insurance, prefer it over signal counting.
  // This allows metadata to disambiguate when signal overlap is ambiguous.
  if (configHint === "bank") return "bank";
  if (configHint === "nbfc") return "nbfc";
  if (configHint === "insurance") return "insurance";

  // Count distinct signal labels per kind.
  // Priority: insurance > bank (≥2 labels) > nbfc > bank (1 label) > generic.
  // A single banking-business investment line on an NBFC's books shouldn't
  // flip the classification — require ≥2 distinct banking labels before
  // declaring "bank" outright. A single banking label still routes to "bank"
  // as a last resort when no NBFC signals are present (review W1).
  const counts = new Map<string, number>();
  for (const s of scope.signals) {
    if (s.kind === "manual-override") continue;
    counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  }
  const insuranceCount = counts.get("insurance") ?? 0;
  if (insuranceCount >= 1)            return "insurance";
  const bankingCount = counts.get("banking") ?? 0;
  const nbfcCount    = counts.get("nbfc")    ?? 0;
  if (bankingCount >= 2)              return "bank";
  if (nbfcCount    >= 1)              return "nbfc";
  if (bankingCount === 1)             return "bank";
  return "generic-financial";
}
