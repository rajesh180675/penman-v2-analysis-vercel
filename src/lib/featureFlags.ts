/**
 * Feature Flags — runtime kill switches for rigor gates.
 *
 * Reads `import.meta.env.VITE_RIGOR_<UPPER_NAME>`. Default policy: enabled.
 * Only the literal string "false" disables a flag; any other value (including
 * malformed input) keeps the flag on. This is intentional — the cost of an
 * accidentally-disabled gate (silent rigor leak in production) is higher than
 * the cost of an accidentally-enabled gate (loud false positive).
 *
 * Flippable via Vercel env without code redeploy. When a flag is off, the
 * corresponding gate is computed and surfaced in UI, but does not affect
 * rigor level (soft-block, see plan v4 N-2).
 */

export type FlagName =
  | "rigor.conceptIdentityBlock"
  | "rigor.economicSanityBlock"
  | "rigor.terminalEligibilityBlock"
  | "rigor.residualScoreDowngrade"
  | "rigor.assumptionProvenanceBlock"
  | "rigor.earningsQualityBlock";

const FLAG_TO_ENV_KEY: Record<FlagName, string> = {
  "rigor.conceptIdentityBlock": "VITE_RIGOR_CONCEPT_IDENTITY_BLOCK",
  "rigor.economicSanityBlock": "VITE_RIGOR_ECONOMIC_SANITY_BLOCK",
  "rigor.terminalEligibilityBlock": "VITE_RIGOR_TERMINAL_ELIGIBILITY_BLOCK",
  "rigor.residualScoreDowngrade": "VITE_RIGOR_RESIDUAL_SCORE_DOWNGRADE",
  "rigor.assumptionProvenanceBlock": "VITE_RIGOR_ASSUMPTION_PROVENANCE_BLOCK",
  "rigor.earningsQualityBlock": "VITE_RIGOR_EARNINGS_QUALITY_BLOCK",
};

/**
 * Read a flag from `import.meta.env`. Defaults to enabled. Only the literal
 * string "false" (case-insensitive) disables the flag.
 */
export function isEnabled(name: FlagName): boolean {
  const envKey = FLAG_TO_ENV_KEY[name];
  const raw = readEnv(envKey);
  if (raw == null) return true;
  if (typeof raw !== "string") return true;
  return raw.trim().toLowerCase() !== "false";
}

/**
 * Snapshot all flag states. Use for telemetry / debug surfaces.
 */
export function snapshotFlags(): Record<FlagName, boolean> {
  return {
    "rigor.conceptIdentityBlock": isEnabled("rigor.conceptIdentityBlock"),
    "rigor.economicSanityBlock": isEnabled("rigor.economicSanityBlock"),
    "rigor.terminalEligibilityBlock": isEnabled("rigor.terminalEligibilityBlock"),
    "rigor.residualScoreDowngrade": isEnabled("rigor.residualScoreDowngrade"),
    "rigor.assumptionProvenanceBlock": isEnabled("rigor.assumptionProvenanceBlock"),
    "rigor.earningsQualityBlock": isEnabled("rigor.earningsQualityBlock"),
  };
}

function readEnv(key: string): unknown {
  // import.meta.env is the Vite-injected env. In test environments
  // (vitest) it is also populated. Fall back to process.env for Node
  // utilities that import this module.
  try {
    const meta = (import.meta as unknown as { env?: Record<string, unknown> });
    if (meta?.env && key in meta.env) {
      return meta.env[key];
    }
  } catch {
    // ignore — some bundlers strip import.meta in non-ESM contexts
  }
  if (typeof process !== "undefined" && process?.env && key in process.env) {
    return process.env[key];
  }
  return undefined;
}
