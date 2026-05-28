/**
 * audit-all-companies-shard-1.spec.ts — Companies 10-19
 * @vitest-environment jsdom
 */
import { describe } from "vitest";
import { createAuditTests } from "./audit-all-companies-setup";

describe("Audit Shard 1 (companies 10-19)", () => {
  createAuditTests({ start: 10, size: 10 });
});
