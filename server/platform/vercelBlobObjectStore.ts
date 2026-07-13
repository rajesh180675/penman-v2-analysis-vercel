import { BlobPreconditionFailedError, copy, del, get, put } from "@vercel/blob";
import type { DurableObjectStore } from "../../src/platform/durablePersistence";

export class VercelBlobObjectStore implements DurableObjectStore {
  private readonly token: string;
  constructor(token = process.env.BLOB_READ_WRITE_TOKEN) {
    if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required for durable object storage.");
    this.token = token;
  }

  async putIfAbsent(key: string, bytes: Uint8Array, options: { readonly contentType: string; readonly contentHash: string }): Promise<"created" | "exists"> {
    try {
      await put(key, Buffer.from(bytes), {
        token: this.token,
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: options.contentType,
        cacheControlMaxAge: 60,
      });
      return "created";
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) return "exists";
      throw error;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const result = await get(key, { token: this.token, access: "private" });
    if (!result || result.statusCode !== 200) return null;
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await del(key, { token: this.token });
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    await copy(sourceKey, destinationKey, { token: this.token, access: "private", addRandomSuffix: false, allowOverwrite: false });
  }
}
