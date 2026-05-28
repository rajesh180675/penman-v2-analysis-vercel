/**
 * audit-all-companies-shard-2.spec.ts — Companies 20-31 (tail shard, sized to cover full registry)
 * @vitest-environment jsdom
 */
import { describe } from "vitest";
import { createAuditTests } from "./audit-all-companies-setup";

describe("Audit Shard 2 (companies 20-31)", () => {
  createAuditTests({ start: 20, size: 12 });
});
