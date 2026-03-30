import { CompanyRegistry } from "./types";

export interface PeerValuationRow {
  companyId: string;
  label: string;
  sector: string | null;
  signalLabel: string | null;
  intrinsicPerShare: number | null;
  marketPrice: number | null;
  expectedCagrStress: number | null;
  opportunityScore: number | null;
  relativeStressCagrVsMedian: number | null;
  relativeValueVsMedian: number | null;
  historyPoints: number;
}

export interface PeerValuationSnapshot {
  peers: PeerValuationRow[];
  medians: {
    intrinsicPerShare: number | null;
    expectedCagrStress: number | null;
    opportunityScore: number | null;
    marketPrice: number | null;
  };
}

function median(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!filtered.length) return null;
  const middle = Math.floor(filtered.length / 2);
  return filtered.length % 2 === 0 ? (filtered[middle - 1] + filtered[middle]) / 2 : filtered[middle];
}

export function buildPeerValuationSnapshot(args: {
  registry: CompanyRegistry;
  workspaceCompanies?: Array<{
    companyId: string;
    label: string;
    issuer?: { sector?: string | null } | null;
    valuations?: Array<{ signalLabel: string; marketPrice: number | null; expectedCagrStress: number | null; stressUpsidePct: number | null; opportunityScore?: number | null }>;
  }>;
  sector?: string | null;
}) {
  const { registry, workspaceCompanies = [], sector } = args;
  const baseRows: PeerValuationRow[] = workspaceCompanies
    .filter((company) => !sector || company.issuer?.sector === sector || company.issuer?.sector == null)
    .map((company) => ({
      companyId: company.companyId,
      label: company.label,
      sector: company.issuer?.sector ?? null,
      signalLabel: company.valuations?.[0]?.signalLabel ?? null,
      intrinsicPerShare: company.valuations?.[0]?.stressUpsidePct != null && company.valuations?.[0]?.marketPrice != null
        ? company.valuations[0].marketPrice * (1 + company.valuations[0].stressUpsidePct)
        : null,
      marketPrice: company.valuations?.[0]?.marketPrice ?? null,
      expectedCagrStress: company.valuations?.[0]?.expectedCagrStress ?? null,
      opportunityScore: company.valuations?.[0]?.opportunityScore ?? null,
      relativeStressCagrVsMedian: null,
      relativeValueVsMedian: null,
      historyPoints: company.valuations?.length ?? 0,
    }));

  const fallbackRows = Object.values(registry.companies)
    .filter((company) => company.recastData.length > 0)
    .map((company) => ({
      companyId: company.id,
      label: company.label || company.id,
      sector: sector ?? null,
      signalLabel: null,
      intrinsicPerShare: null,
      marketPrice: null,
      expectedCagrStress: null,
      opportunityScore: null,
      relativeStressCagrVsMedian: null,
      relativeValueVsMedian: null,
      historyPoints: 0,
    }));

  const peers = baseRows.length ? baseRows : fallbackRows;
  const medians = {
    intrinsicPerShare: median(peers.map((peer) => peer.intrinsicPerShare)),
    expectedCagrStress: median(peers.map((peer) => peer.expectedCagrStress)),
    opportunityScore: median(peers.map((peer) => peer.opportunityScore)),
    marketPrice: median(peers.map((peer) => peer.marketPrice)),
  };
  return {
    peers: peers.map((peer) => ({
      ...peer,
      relativeStressCagrVsMedian:
        peer.expectedCagrStress != null && medians.expectedCagrStress != null
          ? peer.expectedCagrStress - medians.expectedCagrStress
          : null,
      relativeValueVsMedian:
        peer.intrinsicPerShare != null && medians.intrinsicPerShare != null
          ? peer.intrinsicPerShare - medians.intrinsicPerShare
          : null,
    })),
    medians,
  } satisfies PeerValuationSnapshot;
}
