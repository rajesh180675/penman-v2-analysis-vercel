import { describe, expect, it, vi } from "vitest";
import { WebhookOutboxSink } from "./webhookOutboxSink";

describe("WebhookOutboxSink", () => {
  it("signs a stable body and exposes the idempotency key", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const sink = new WebhookOutboxSink({ endpoint: "https://events.example.test/platform", secret: new Uint8Array(32).fill(7), fetchImpl });
    await sink.deliver({ organizationId: "org-1", workspaceId: "ws-1", messageId: "msg-1", topic: "run.finalized", aggregateId: "run-1", payload: { revision: 2 }, attemptCount: 0 });
    expect(captured?.headers).toMatchObject({ "x-platform-message-id": "msg-1", "x-platform-topic": "run.finalized" });
    expect((captured?.headers as Record<string, string>)["x-platform-signature"]).toMatch(/^hmac-sha256=[A-Za-z0-9_-]{43}$/);
  });

  it("rejects insecure endpoints and weak keys", () => {
    expect(() => new WebhookOutboxSink({ endpoint: "http://example.test", secret: new Uint8Array(32) })).toThrow(/HTTPS/);
    expect(() => new WebhookOutboxSink({ endpoint: "https://example.test", secret: new Uint8Array(8) })).toThrow(/256 bits/);
  });
});
