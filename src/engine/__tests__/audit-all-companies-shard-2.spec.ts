/**
 * audit-all-companies-shard-2.spec.ts — the last slice of the registry.
 *
 * The slice bounds are computed from the live registry length (`tileShard`),
 * not written here. This is the shard the old hardcoding got wrong: it carried
 * `{ start: 20, size: 12 }` under the comment "tail shard, sized to cover full
 * registry", which was true at 32 companies and silently false at 33 — see
 * `scripts/lib/auditShards.ts`.
 *
 * @vitest-environment node
 */
import { describe } from "vitest";
import { createShardAuditTests } from "./audit-all-companies-setup";

describe("Audit Shard 2", () => {
  createShardAuditTests(2);
});
