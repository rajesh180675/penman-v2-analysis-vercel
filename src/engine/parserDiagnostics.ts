export interface ParserFidelityCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface SourceParserDiagnostics {
  sourceMode?: string | null | undefined;
  warningCount: number;
  errorCount: number;
  checks: ParserFidelityCheck[];
}
