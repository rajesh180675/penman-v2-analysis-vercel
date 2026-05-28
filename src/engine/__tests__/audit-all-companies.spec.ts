/**
 * audit-all-companies.spec.ts — Rigorous valuation audit across all companies.
 *
 * Loads each company's ZIP, parses Capitaline data, runs pipeline + valuation engine,
 * and reports any NaN, missing, or suspicious results per valuation lens.
 *
 * For batched (sharded) execution, use the shard-specific spec files instead:
 *   npx vitest run src/engine/__tests__/audit-all-companies.shard-*.spec.ts
 *
 * @vitest-environment jsdom
 */
import { describe } from "vitest";
import { createAuditTests } from "./audit-all-companies-setup";

describe("Audit all companies (full run)", () => {
  createAuditTests({ start: 0, size: 999 });
});
