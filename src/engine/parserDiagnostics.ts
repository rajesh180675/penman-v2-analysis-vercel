export interface ParserFidelityCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface SourceParserDiagnostics {
  sourceMode?: string | null;
  warningCount: number;
  errorCount: number;
  checks: ParserFidelityCheck[];
}
