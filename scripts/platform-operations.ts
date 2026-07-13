import { pathToFileURL } from "node:url";
import { chmod, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import type { DurableObjectStore, TransactionalSqlDriver } from "../src/platform/durablePersistence/contracts";
import { buildPlatformActivationPreflight, type PlatformActivationProfile } from "../src/platform/operations/activationPreflight";

interface RuntimeModule {
  createPlatformRuntime(): Promise<{ readonly sql: TransactionalSqlDriver; readonly objects: DurableObjectStore }> | { readonly sql: TransactionalSqlDriver; readonly objects: DurableObjectStore };
}

async function runtime() {
  const modulePath = process.env.PLATFORM_RUNTIME_MODULE ?? "server/platform/defaultRuntime.ts";
  const loaded = await import(pathToFileURL(resolve(modulePath)).href) as RuntimeModule;
  if (typeof loaded.createPlatformRuntime !== "function") throw new Error("Platform runtime module does not export createPlatformRuntime().");
  return loaded.createPlatformRuntime();
}

function backupAuthenticationMaterial() {
  const secret = process.env.PLATFORM_BACKUP_HMAC_KEY_BASE64;
  const keyId = process.env.PLATFORM_BACKUP_HMAC_KEY_ID;
  if (!secret || !keyId) throw new Error("PLATFORM_BACKUP_HMAC_KEY_BASE64 and PLATFORM_BACKUP_HMAC_KEY_ID are required.");
  return Object.freeze({ keyId, secret: new Uint8Array(Buffer.from(secret, "base64")) });
}

const usage = "Usage: platform-operations <preflight|generate-secrets|migrate|probe|backup|restore-drill|bootstrap-admin|dispatch-outbox> [arguments]";

async function generateSecretFile(outputPath: string, generatedAt: string): Promise<void> {
  const resolvedPath = resolve(outputPath);
  const backupKeyId = `backup-${generatedAt.slice(0, 10)}`;
  const lines = [
    "# Penman production-platform activation secrets.",
    `# Generated ${generatedAt}. Fill provider-owned values, then store all values in the deployment secret manager.`,
    "# This file is local-only and must never be committed.",
    "PLATFORM_DATABASE_URL=",
    "BLOB_READ_WRITE_TOKEN=",
    "PLATFORM_SESSION_ISSUER=",
    "PLATFORM_SESSION_AUDIENCE=",
    `PLATFORM_BACKUP_HMAC_KEY_ID=${backupKeyId}`,
    `PLATFORM_BACKUP_HMAC_KEY_BASE64=${randomBytes(48).toString("base64")}`,
    `PLATFORM_OUTBOX_HMAC_KEY_BASE64=${randomBytes(48).toString("base64")}`,
    "PLATFORM_OUTBOX_WEBHOOK_URL=",
    "PLATFORM_HEALTH_ORGANIZATION_ID=",
    "PLATFORM_HEALTH_WORKSPACE_ID=",
    `PLATFORM_HEALTH_TOKEN=${randomBytes(48).toString("base64url")}`,
    `CRON_SECRET=${randomBytes(48).toString("base64url")}`,
    "",
  ];
  await writeFile(resolvedPath, lines.join("\n"), { encoding: "utf8", flag: "wx", mode: 0o600 });
  await chmod(resolvedPath, 0o600);
  console.log(JSON.stringify({
    ok: true,
    outputPath: resolvedPath,
    generatedVariables: [
      "PLATFORM_BACKUP_HMAC_KEY_ID", "PLATFORM_BACKUP_HMAC_KEY_BASE64",
      "PLATFORM_OUTBOX_HMAC_KEY_BASE64", "PLATFORM_HEALTH_TOKEN", "CRON_SECRET",
    ],
    providerVariablesRequiringInput: [
      "PLATFORM_DATABASE_URL", "BLOB_READ_WRITE_TOKEN", "PLATFORM_SESSION_ISSUER",
      "PLATFORM_SESSION_AUDIENCE", "PLATFORM_OUTBOX_WEBHOOK_URL",
      "PLATFORM_HEALTH_ORGANIZATION_ID", "PLATFORM_HEALTH_WORKSPACE_ID",
    ],
  }, null, 2));
}

async function main(): Promise<void> {
  const [command, first, second, third] = process.argv.slice(2);
  if (!command) throw new Error(usage);
  const now = new Date().toISOString();

  if (command === "preflight") {
    const profile = first ?? "release";
    if (!(["runtime", "operations", "release"] as readonly string[]).includes(profile)) throw new Error("Preflight profile must be runtime, operations, or release.");
    const report = buildPlatformActivationPreflight(process.env, profile as PlatformActivationProfile);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "ready") process.exitCode = 2;
    return;
  }

  if (command === "generate-secrets") {
    if (!first) throw new Error("generate-secrets requires an explicit output path, for example .env.platform.local.");
    await generateSecretFile(first, now);
    return;
  }

  const adapters = await runtime();
  const organizationId = first;
  const workspaceId = second;
  const principalId = third;

  if (command === "migrate") {
    const { applyPlatformMigrations, inspectPlatformMigrationState } = await import("../src/platform/durablePersistence/migrations");
    const before = await inspectPlatformMigrationState(adapters.sql);
    if (before.checksumMismatchIds.length) throw new Error(`Migration checksum mismatch: ${before.checksumMismatchIds.join(", ")}`);
    const applied = await applyPlatformMigrations({ driver: adapters.sql, alreadyApplied: before.appliedIds });
    const after = await inspectPlatformMigrationState(adapters.sql);
    if (after.pendingIds.length || after.checksumMismatchIds.length) throw new Error("Migration state did not converge to current.");
    console.log(JSON.stringify({ ok: true, applied }, null, 2));
  } else if (command === "dispatch-outbox") {
    const [{ SqlOutboxDispatcher }, { WebhookOutboxSink }] = await Promise.all([
      import("../src/platform/durablePersistence/sqlOutbox"),
      import("../server/platform/webhookOutboxSink"),
    ]);
  const endpoint = process.env.PLATFORM_OUTBOX_WEBHOOK_URL;
  const secret = process.env.PLATFORM_OUTBOX_HMAC_KEY_BASE64;
  if (!endpoint || !secret) throw new Error("PLATFORM_OUTBOX_WEBHOOK_URL and PLATFORM_OUTBOX_HMAC_KEY_BASE64 are required.");
  const sink = new WebhookOutboxSink({ endpoint, secret: new Uint8Array(Buffer.from(secret, "base64")) });
  const result = await new SqlOutboxDispatcher(adapters.sql, sink).dispatchBatch({ workerId: process.env.PLATFORM_OUTBOX_WORKER_ID ?? `cli-${process.pid}`, now, limit: Number(process.env.PLATFORM_OUTBOX_BATCH_SIZE ?? 50) });
  console.log(JSON.stringify({ ok: result.failed === 0, ...result }, null, 2));
  } else {
    if (!organizationId || !workspaceId) throw new Error(`${command} requires organizationId and workspaceId.`);
    if (command === "probe") {
      const { ProductionPlatformProbe } = await import("../src/platform/operations/productionProbe");
      console.log(JSON.stringify(await new ProductionPlatformProbe(adapters.sql, adapters.objects).run({ organizationId, workspaceId, probeId: `probe-${Date.now()}`, checkedAt: now }), null, 2));
    } else if (command === "backup") {
      const [{ HmacSha256BackupAuthenticator }, { ProductionBackupRestoreDrill }] = await Promise.all([
        import("../src/platform/operations/backupRestore"),
        import("../src/platform/operations/productionDrill"),
      ]);
      const material = backupAuthenticationMaterial();
      const authenticator = new HmacSha256BackupAuthenticator(material.keyId, material.secret);
      const result = await new ProductionBackupRestoreDrill(adapters.sql, adapters.objects, authenticator).createWorkspaceBackup({ organizationId, workspaceId, backupId: `backup-${Date.now()}`, createdAt: now });
      console.log(JSON.stringify({ ok: true, objectKey: result.objectKey, manifest: result.package.manifest }, null, 2));
    } else if (command === "restore-drill") {
      const [{ HmacSha256BackupAuthenticator }, { ProductionBackupRestoreDrill }] = await Promise.all([
        import("../src/platform/operations/backupRestore"),
        import("../src/platform/operations/productionDrill"),
      ]);
      const material = backupAuthenticationMaterial();
      const authenticator = new HmacSha256BackupAuthenticator(material.keyId, material.secret);
      console.log(JSON.stringify(await new ProductionBackupRestoreDrill(adapters.sql, adapters.objects, authenticator).runLatestRestoreDrill({ organizationId, workspaceId, drillId: `drill-${Date.now()}`, restoredAt: now }), null, 2));
    } else if (command === "bootstrap-admin") {
      if (!principalId) throw new Error("bootstrap-admin requires principalId.");
      await adapters.sql.transaction(async (tx) => {
      await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`platform-bootstrap:${organizationId}:${workspaceId}`]);
      const existing = await tx.query<{ count: number | string } & Record<string, unknown>>("select count(*) as count from platform_workspace_memberships where organization_id = $1 and workspace_id = $2", [organizationId, workspaceId]);
      if (Number(existing.rows[0]?.count ?? 0) !== 0) throw new Error("Bootstrap is allowed only before the first workspace membership exists.");
      await tx.query(
        `insert into platform_workspace_memberships (organization_id, workspace_id, principal_id, roles, status, valid_from, valid_until)
         values ($1,$2,$3,'["administrator"]'::jsonb,'active',$4,null)`, [organizationId, workspaceId, principalId, now],
      );
      await tx.query(
        `insert into platform_membership_events (organization_id, workspace_id, event_id, target_principal_id, actor_principal_id, occurred_at, previous_membership, next_membership)
         values ($1,$2,$3,$4,'platform-bootstrap',$5,null,$6::jsonb)`,
        [organizationId, workspaceId, `bootstrap:${principalId}`, principalId, now, JSON.stringify({ principalId, organizationId, workspaceId, roles: ["administrator"], status: "active", validFrom: now, validUntil: null })],
      );
      });
      console.log(JSON.stringify({ ok: true, organizationId, workspaceId, principalId, role: "administrator" }, null, 2));
    } else throw new Error(`Unknown command '${command}'. ${usage}`);
  }
}

await main();
