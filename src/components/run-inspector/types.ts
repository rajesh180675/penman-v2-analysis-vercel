export type InspectorPayload = {
  ok: boolean;
  runId: string;
  latestAt: string | null;
  counts: { events: number; inputs: number; artifacts: number };
  inputs: AuditBlobItem[];
  artifacts: AuditBlobItem[];
  timeline: Array<{
    pathname: string;
    uploadedAt: string;
    createdAt: string;
    eventType: string;
    companyId: string | null;
    sourceMode: string | null;
    payloadSummary: Record<string, unknown> | null;
    analysisSnapshot?: {
      latestPeriod?: string | null | undefined;
      qualityGate?: { tier?: string | undefined; valuationBlocked?: boolean } | null;
      traceability?: {
        confidence?: { status?: string | undefined; headline?: string } | null;
      } | null;
    } | null;
  }>;
  health: {
    severity: "ok" | "warning" | "critical";
    findings: string[];
    recommendations: string[];
    derived: {
      hasAnalysisReady: boolean;
      hasArtifacts: boolean;
      hasInputs: boolean;
    };
  };
  persistedMonitorReport?: {
    generatedAt?: string | undefined;
    severity?: string | undefined;
    actions?: Array<{ type: string; created?: boolean | undefined; issueUrl?: string | undefined; reason?: string }>;
  } | null;
  latestAnalysisSnapshot?: {
    family?: string | null | undefined;
    latestPeriod?: string | null | undefined;
    traceability?: {
      schemaVersion?: string | undefined;
      generatedAt?: string | null | undefined;
      runContext?: {
        runId?: string | null | undefined;
        companyId?: string | null | undefined;
        sourceMode?: string | null | undefined;
        periodCount?: number | undefined;
        latestPeriod?: string | null | undefined;
      } | null;
      confidence?: {
        status?: string | undefined;
        headline?: string | undefined;
        blockingCount?: number | undefined;
        diagnosticCount?: number | undefined;
        optionalCount?: number | undefined;
      } | null;
      parserFidelity?: {
        status?: string | undefined;
        score?: number | undefined;
        summary?: string | undefined;
      } | null;
      reconciliation?: {
        status?: string | undefined;
        summary?: string | undefined;
        warningCount?: number | undefined;
        errorCount?: number | undefined;
        maxResidualRatio?: number | undefined;
      } | null;
      conceptIdentity?: {
        status?: string | undefined;
        conflictCount?: number | undefined;
        unresolvedCriticalCount?: number | undefined;
        truncated?: boolean | undefined;
      } | null;
      economicSanity?: {
        status?: string | undefined;
        anchorPeriod?: string | null | undefined;
        anchorReason?: string | undefined;
        skippedPeriods?: { period: string; reason: string }[];
        failedChecks?: { checkId: string; passed: boolean; severity: string }[];
      } | null;
      unusualItemManifest?: {
        totalUnusualImpactOnCoreOI?: number | undefined;
        terminalEligibilityBlocked?: boolean | undefined;
        classifications?: Array<{ category?: string | undefined; period?: string | undefined; affectsTerminalEligibility?: boolean }>;
        unclassifiedCount?: number | undefined;
        truncated?: boolean | undefined;
      } | null;
      lineageRef?: {
        hasLineage?: boolean | undefined;
        conceptCount?: number | undefined;
        periodCount?: number | undefined;
        checksum?: string | undefined;
      } | null;
      rigor?: {
        currentLevel?: string | undefined;
        currentLabel?: string | undefined;
        summary?: string | undefined;
        achievedLevels?: string[] | undefined;
        pendingLevels?: string[] | undefined;
      } | null;
      mappingCoverage?: {
        outOfSpecLabelCount?: number | undefined;
        actionableOutOfSpecLabelCount?: number | undefined;
        backlogByAction?: Record<string, number>;
      } | null;
      analysisContext?: {
        rawPeriodCount?: number | undefined;
        recastPeriodCount?: number | undefined;
        hasRecastData?: boolean | undefined;
        hasDebugInfo?: boolean | undefined;
        debugFiles?: number | undefined;
        rawMetricKeyCount?: number | undefined;
        engineError?: string | null | undefined;
      } | null;
      backlogPreview?: Array<{
        statement: string;
        key: string;
        action: string;
        priority: string;
        periodsObserved: number;
        latestValue: number | null;
      }>;
    } | null;
  } | null;
  latestMarketSnapshot?: {
    symbol?: string | null | undefined;
    provider?: string | null | undefined;
    fetchedAt?: string | null | undefined;
    price?: number | null | undefined;
    riskFreeRate?: number | null | undefined;
    freshness?: string | null | undefined;
    sourceSummary?: string | null | undefined;
    warnings?: string[] | undefined;
    history?: {
      currentPricePercentile?: number | null | undefined;
      low52Week?: number | null | undefined;
      high52Week?: number | null | undefined;
      distanceFrom52WeekLowPct?: number | null | undefined;
      drawdownFrom52WeekHighPct?: number | null | undefined;
    } | null;
  } | null;
  latestValuationSignal?: {
    state?: string | null | undefined;
    label?: string | null | undefined;
    summary?: string | null | undefined;
    confidenceState?: string | null | undefined;
    stressUpsidePct?: number | null | undefined;
    baseUpsidePct?: number | null | undefined;
    historicalPercentile?: number | null | undefined;
    reverseDcfImpliedGrowth?: number | null | undefined;
    requiredMarginOfSafetyPct?: number | null | undefined;
    qualityScore?: number | null | undefined;
    opportunityScore?: number | null | undefined;
    convictionBucket?: string | null | undefined;
    expectedCagrStress?: number | null | undefined;
    killSwitches?: string[] | undefined;
    supportingFlags?: string[] | undefined;
    scenarios?: Array<{
      key?: string | undefined;
      label?: string | undefined;
      intrinsicPerShare?: number | null | undefined;
      upsidePct?: number | null | undefined;
    }>;
    marketPrice?: number | null | undefined;
    asOf?: string | null | undefined;
  } | null;
  latestValuationManifest?: {
    asOf?: string | null | undefined;
    marketPrice?: number | null | undefined;
    riskFreeRate?: number | null | undefined;
    sectorTemplate?: { label?: string | null | undefined; source?: string | null } | null;
    diagnostics?: {
      ownerEarningsPerShare?: number | null | undefined;
      reinvestmentRate?: number | null | undefined;
      incrementalRoic?: number | null | undefined;
    } | null;
    reverseDcf?: {
      impliedOwnerEarningsGrowth?: number | null | undefined;
      expectationLabel?: string | null | undefined;
    } | null;
    opportunity?: {
      qualityScore?: number | null | undefined;
      requiredMarginOfSafetyPct?: number | null | undefined;
      expectedCagrStress?: number | null | undefined;
      opportunityScore?: number | null | undefined;
      convictionBucket?: string | null | undefined;
      thesis?: string | null | undefined;
    } | null;
    checklist?: {
      whatMustGoRight?: string[] | undefined;
      thesisBreakers?: string[] | undefined;
    } | null;
    marketContext?: {
      expectedReturnSpreadVsRf?: number | null | undefined;
      marketCapFromPrice?: number | null | undefined;
      enterpriseValueFromPrice?: number | null | undefined;
      priceToStressValueRatio?: number | null | undefined;
    } | null;
    backtest?: {
      available?: boolean | undefined;
      investableCount?: number | undefined;
      highConvictionCount?: number | undefined;
      screamingBuyCount?: number | undefined;
      forwardWinRate1Y?: number | null | undefined;
      forwardWinRate3Y?: number | null | undefined;
      median1Y?: number | null | undefined;
      median3Y?: number | null | undefined;
      latestComparedToHistory?: string | null | undefined;
      points?: Array<{
        periodEnd?: string | undefined;
        state?: string | undefined;
        realized1Y?: number | null | undefined;
        realized3Y?: number | null | undefined;
      }>;
    } | null;
  } | null;
  latestValuationAlert?: {
    state?: string | null | undefined;
    label?: string | null | undefined;
    summary?: string | null | undefined;
    opportunityScore?: number | null | undefined;
    convictionBucket?: string | null | undefined;
    expectedCagrStress?: number | null | undefined;
    marketPrice?: number | null | undefined;
    asOf?: string | null | undefined;
  } | null;
  governance?: {
    retentionDays?: number | undefined;
    contentClass?: string | undefined;
    adminTokenVersion?: string | undefined;
  } | null;
  retentionHealth?: {
    status: "healthy" | "scheduled" | "warning" | "not-yet-checked";
    mode: "local-opportunistic" | "vercel-cron";
    lastCheckedAt: string | null;
    expiredRunCount: number;
    expiredArtifactCount: number;
    orphanCount: number;
    summary: string;
  } | null;
};

export type AuditBlobItem = {
  pathname: string;
  uploadedAt: string;
  size: number;
  contentType?: string | undefined;
  contentEncoding?: string | null | undefined;
  eventType?: string | null | undefined;
};

export type WatchlistRow = {
  runId: string;
  companyId: string;
  sourceMode: string;
  signalLabel: string;
  convictionBucket: string;
  opportunityScore: number | null;
  expectedCagrStress: number | null;
  latestAt: string | null;
};
