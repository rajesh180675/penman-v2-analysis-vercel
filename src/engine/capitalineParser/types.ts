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

export interface SourceArtifactHash {
  /** Basename of the .xls/.html/.xml/.csv file inside the ZIP. */
  fileName: string;
  /** SHA-256 hex digest of the uncompressed file bytes. */
  sha256: string;
  /** Uncompressed byte length. */
  byteLength: number;
}

/** Exact winning source coordinate for a raw metric after standard precedence. */
export interface CapitalineFactOrigin {
  readonly fileName: string;
  readonly parserMethod: string;
  /** One-based source row/column. */
  readonly row: number;
  readonly column: number;
}

export interface CapitalineParseDebug {
  companyId: string;
  files: Array<{ name: string; statementGuess: CapitalineStatement }>;
  detectedPeriods: string[];
  /** Per-file SHA-256 hashes for source-lineage evidence. Empty when no
   *  ZIP was parsed (manual entry, JSON import, etc.). */
  sourceArtifactHashes: SourceArtifactHash[];
  /** period_end -> emitted raw key -> winning file/cell origin. */
  factOrigins?: Readonly<Record<string, Readonly<Record<string, CapitalineFactOrigin>>>> | undefined;
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
  Map<string, {
    value: number | null;
    statement: CapitalineStatement;
    standard: AccountingStandard;
    origin?: CapitalineFactOrigin | undefined;
  }>
>;
