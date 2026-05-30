/**
 * audit-all-companies-shard-0.spec.ts — Companies 0-9
 * @vitest-environment node
 */
import { describe } from "vitest";
import { createAuditTests } from "./audit-all-companies-setup";

describe("Audit Shard 0 (companies 0-9)", () => {
  createAuditTests({ start: 0, size: 10 });
});
