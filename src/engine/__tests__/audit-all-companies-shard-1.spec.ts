/**
 * audit-all-companies-shard-1.spec.ts — the second slice of the registry.
 *
 * The slice bounds are computed from the live registry length (`tileShard`),
 * not written here. Hardcoded bounds are what left the registry's last company
 * audited by no shard at all — see `scripts/lib/auditShards.ts`.
 *
 * @vitest-environment node
 */
import { describe } from "vitest";
import { createShardAuditTests } from "./audit-all-companies-setup";

describe("Audit Shard 1", () => {
  createShardAuditTests(1);
});
