import { createHmac } from "node:crypto";
import type { PlatformOutboxMessage, PlatformOutboxSink } from "../../src/platform";

export interface WebhookOutboxSinkOptions {
  readonly endpoint: string;
  readonly secret: Uint8Array;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/** Signed delivery adapter. Receivers deduplicate using x-platform-message-id. */
export class WebhookOutboxSink implements PlatformOutboxSink {
  readonly #endpoint: string;
  readonly #secret: Uint8Array;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: WebhookOutboxSinkOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== "https:") throw new Error("PLATFORM_OUTBOX_WEBHOOK_URL must use HTTPS.");
    if (options.secret.byteLength < 32) throw new Error("Outbox webhook signing keys must contain at least 256 bits.");
    this.#endpoint = endpoint.toString();
    this.#secret = new Uint8Array(options.secret);
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 100 || this.#timeoutMs > 60_000) throw new Error("Outbox webhook timeout is invalid.");
  }

  async deliver(message: PlatformOutboxMessage): Promise<void> {
    const body = JSON.stringify(message);
    const signature = createHmac("sha256", this.#secret).update(body).digest("base64url");
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-platform-message-id": message.messageId,
        "x-platform-topic": message.topic,
        "x-platform-signature": `hmac-sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) throw new Error(`Outbox webhook rejected delivery with status ${response.status}.`);
  }
}
