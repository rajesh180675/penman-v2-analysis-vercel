import { WorkspaceCompanyRecord, WorkspacePortfolioPlan, WorkspaceResearchJournalEntry, WorkspaceValuationSnapshot } from "./researchWorkspace";

async function postJson(path: string, payload: unknown) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return await response.json();
  } catch {
    return null;
  }
}

export async function syncWorkspaceProfile(company: WorkspaceCompanyRecord | null) {
  if (!company) return null;
  return postJson("/api/companies", {
    companyId: company.companyId,
    issuer: company.issuer,
    notebook: company.notes,
    portfolio: company.portfolio,
  });
}

export async function syncWorkspaceFilings(companyId: string, filings: WorkspaceCompanyRecord["filings"]) {
  const latest = filings[0];
  if (!companyId || !latest) return null;
  return postJson("/api/filings", {
    companyId,
    filing: latest,
  });
}

export async function syncWorkspaceValuation(companyId: string, valuation: WorkspaceValuationSnapshot | null) {
  if (!companyId || !valuation) return null;
  return postJson("/api/valuations", {
    companyId,
    valuation,
  });
}

export async function syncWorkspacePortfolio(companyId: string, portfolio: WorkspacePortfolioPlan) {
  if (!companyId) return null;
  return postJson("/api/watchlist", {
    companyId,
    portfolio,
  });
}

export async function syncWorkspaceJournal(companyId: string, journal: WorkspaceResearchJournalEntry | null) {
  if (!companyId || !journal) return null;
  return postJson("/api/research", {
    companyId,
    journal,
  });
}

export async function syncWorkspaceAlert(companyId: string, alert: Record<string, unknown> | null) {
  if (!companyId || !alert) return null;
  return postJson("/api/alerts", {
    companyId,
    alert,
  });
}
