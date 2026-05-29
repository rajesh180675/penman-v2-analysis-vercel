/* ================================================================
   v3Analytics decomposition — metadata firewall (audit-marker leak
   prevention for rendered reports).

   Lifted verbatim from src/engine/v3Analytics.ts. Pure string/regex
   functions with no imports — a true leaf. v3Analytics.ts re-exports
   the public surface, leaving external import paths
   (supplementaryPathA.spec) unchanged. Behaviour byte-for-byte
   identical.
================================================================ */

export const AUDIT_MARKERS: RegExp[] = [
  /V\d+ §\d+/g,
  /✓|✗/g,
  /\bintact\b/gi,
  /COMPLIANCE_CHECK/g,
  /__debug__/g,
];
export function firewallCheck(renderedText: string, auditLog: string[] = []): string[] {
  const violations: string[] = [];
  for (const pattern of AUDIT_MARKERS) {
    const matches = renderedText.match(pattern);
    if (matches?.length) {
      violations.push(`Audit marker '${pattern.source}' found in rendered output: ${matches.slice(0, 3).join(', ')}`);
    }
  }
  for (const entry of auditLog) {
    const chunks = entry.split(/[.;]/).map((x) => x.trim()).filter((x) => x.length >= 20);
    for (const chunk of chunks) {
      if (renderedText.includes(chunk)) {
        violations.push(`Audit log content leaked: '${chunk.slice(0, 50)}...'`);
      }
    }
  }
  return violations;
}
export function enforceMetadataFirewall(renderedText: string, auditLog: string[] = []): { rendered: string; violations: string[] } {
  const violations = firewallCheck(renderedText, auditLog);
  if (!violations.length) return { rendered: renderedText, violations };
  let sanitized = renderedText;
  for (const pattern of AUDIT_MARKERS) {
    sanitized = sanitized.replace(new RegExp(`[^.\\n]*${pattern.source}[^.\\n]*\\.?`, "gi"), "[REDACTED: internal audit content removed]");
  }
  sanitized += "\n\nNote: Internal audit markers were detected and redacted from this report. See compliance log.";
  return { rendered: sanitized, violations };
}
