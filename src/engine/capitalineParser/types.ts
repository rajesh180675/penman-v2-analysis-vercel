import { AccountingStandard } from "../standardAliases";

/* ══════════════════════════════════════════════════════════════════
   Public types
══════════════════════════════════════════════════════════════════ */

export type CapitalineStatement =
  | "BalanceSheet"
  | "ProfitLoss"
  | "CashFlow"
  | "Segment"
  | "Unknown";

export interface ParseWarning {
  file?: string | undefined;
  message: string;
  detail?: string | undefined;
}

/**
 * Phase A — multi-standard ingestion provenance.
 * Per-period record of which accounting-standard files contributed values.
 */
export interface PeriodStandardProvenance {
  period_end: string;
  /** Standard that won precedence (Ind-AS > REV > Standard > Unknown) */
  dominantStandard: AccountingStandard;
  /** All standards that contributed any value to this period */
  contributingStandards: AccountingStandard[];
  /** Number of composite keys whose dominant value came from a non-Ind-AS source */
  filledFromOlderStandard: number;
}

export interface RawGridDebug {
  file: string;
  methods: string[];
  bestMethod: string;
  rowCount: number;
  colCount: number;
  firstRows: string[][];
  headerDetected: boolean;
  headerRowIndex?: number | undefined;
  periodLabels?: string[] | undefined;
  errors: string[];
}

export interface CapitalineParseDebug {
  companyId: string;
  files: Array<{ name: string; statementGuess: CapitalineStatement }>;
  detectedPeriods: string[];
  rawGrids: RawGridDebug[];
  metrics: {
    totalCompositeKeys: number;
    totalBaseKeys: number;
    baseKeyCollisions: Array<{
      metric: string;
      statements: CapitalineStatement[];
      keptStatement: CapitalineStatement;
    }>;
    byStatement: Record<CapitalineStatement, number>;
  };
  warnings: ParseWarning[];
  sample: {
    headerRow?: string[] | undefined;
    firstRows: Array<{
      metric: string;
      statement: CapitalineStatement;
      values: Array<string | null>;
    }>;
  };
  rawMetricKeys: string[];
}

export type CurrencyUnit =
  | "Crores"
  | "Lakhs"
  | "Millions"
  | "Thousands"
  | "Absolute"
  | "Unknown";

export interface HeaderInfo {
  rowIndex: number;
  metricCol: number;
  periodCols: Array<{ col: number; period_end: string; label: string }>;
}

export type PeriodMap = Map<
  string,
  Map<string, { value: number | null; statement: CapitalineStatement; standard: AccountingStandard }>
>;
