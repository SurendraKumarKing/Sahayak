import { BlobServiceClient } from "@azure/storage-blob";
import type { TokenCredential } from "@azure/core-auth";
import type { SahayakDocument } from "@sahayak/shared";
import { randomUUID } from "node:crypto";
import { TTL_MS } from "./config.js";
import { ApiError, checkAbort, notFound } from "./errors.js";

export interface StoredDocument { document: SahayakDocument; expiresAt: number; version: string }
export interface DocumentStore {
  get(owner: string, id: string, signal: AbortSignal): Promise<StoredDocument>;
  put(owner: string, value: StoredDocument, expectedVersion: string | undefined, signal: AbortSignal): Promise<void>;
  delete(owner: string, id: string, signal: AbortSignal): Promise<void>;
}
export function newStored(document: SahayakDocument): StoredDocument {
  return { document, expiresAt: Date.now() + TTL_MS, version: randomUUID() };
}
export class MemoryStore implements DocumentStore {
  private entries = new Map<string, StoredDocument>();
  constructor(private maxTotal = 200, private maxPerOwner = 20, private now = Date.now) {}
  private clean() {
    for (const [key, value] of this.entries) if (value.expiresAt <= this.now()) this.entries.delete(key);
  }
  async get(owner: string, id: string, signal: AbortSignal): Promise<StoredDocument> {
    checkAbort(signal); this.clean();
    const value = this.entries.get(`${owner}/${id}`);
    if (!value) return notFound();
    return structuredClone(value);
  }
  async put(owner: string, value: StoredDocument, expectedVersion: string | undefined, signal: AbortSignal) {
    checkAbort(signal); this.clean();
    const key = `${owner}/${value.document.id}`;
    const previous = this.entries.get(key);
    if ((expectedVersion && previous?.version !== expectedVersion) || (!expectedVersion && previous))
      throw new ApiError(409, "CONFLICT", "Document changed. Reload before editing.");
    if (!previous && (this.entries.size >= this.maxTotal || [...this.entries.keys()].filter(k => k.startsWith(`${owner}/`)).length >= this.maxPerOwner))
      throw new ApiError(429, "DEMO_CAPACITY", "Demo document capacity reached. Delete older documents or retry after expiry.");
    this.entries.set(key, structuredClone({ ...value, version: randomUUID() }));
  }
  async delete(owner: string, id: string, signal: AbortSignal) {
    await this.get(owner, id, signal);
    checkAbort(signal); this.entries.delete(`${owner}/${id}`);
  }
}

export class AzureStore implements DocumentStore {
  private container;
  constructor(accountUrl: string, container: string, credential: TokenCredential) {
    this.container = new BlobServiceClient(accountUrl, credential, { retryOptions: { maxTries: 2 } }).getContainerClient(container);
  }
  private blob(owner: string, id: string) { return this.container.getBlockBlobClient(`${owner}/${id}.json`); }
  async get(owner: string, id: string, signal: AbortSignal): Promise<StoredDocument> {
    try {
      const response = await this.blob(owner, id).download(0, undefined, { abortSignal: signal });
      const parts: Buffer[] = [];
      let length = 0;
      for await (const chunk of response.readableStreamBody!) {
        checkAbort(signal);
        const bytes = Buffer.from(chunk);
        length += bytes.length;
        if (length > 2 * 1024 * 1024) throw new ApiError(502, "STORAGE_INVALID", "Stored document exceeds supported limits.");
        parts.push(bytes);
      }
      const value = JSON.parse(Buffer.concat(parts).toString("utf8")) as StoredDocument;
      if (value.expiresAt <= Date.now()) {
        await this.blob(owner, id).deleteIfExists({ conditions: { ifMatch: response.etag }, abortSignal: signal });
        return notFound();
      }
      return { ...value, version: response.etag! };
    } catch (error) {
      if (status(error) === 404) return notFound();
      throw error;
    }
  }
  async put(owner: string, value: StoredDocument, expectedVersion: string | undefined, signal: AbortSignal) {
    checkAbort(signal);
    const data = Buffer.from(JSON.stringify(value));
    if (data.length > 2 * 1024 * 1024) throw new ApiError(413, "DOCUMENT_STATE_TOO_LARGE", "Derived document exceeds the 2 MiB storage limit.");
    try {
      await this.blob(owner, value.document.id).uploadData(data, {
        abortSignal: signal,
        conditions: expectedVersion ? { ifMatch: expectedVersion } : { ifNoneMatch: "*" },
        blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8" },
        metadata: { expiresat: String(value.expiresAt) }
      });
    } catch (error) {
      if (status(error) === 412 || status(error) === 409)
        throw new ApiError(409, "CONFLICT", "Document changed. Reload before editing.");
      throw error;
    }
  }
  async delete(owner: string, id: string, signal: AbortSignal) {
    const current = await this.get(owner, id, signal);
    try { await this.blob(owner, id).delete({ conditions: { ifMatch: current.version }, abortSignal: signal }); }
    catch (error) {
      if (status(error) === 412) throw new ApiError(409, "CONFLICT", "Document changed. Reload before deleting.");
      throw error;
    }
  }
}
function status(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : undefined;
}
