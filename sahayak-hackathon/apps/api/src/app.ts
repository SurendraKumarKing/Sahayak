import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ChatSchema, FieldsSchema, FillSchema, LanguageRequestSchema, SchemeRequestSchema,
  TranscribeSchema, UploadSchema,
  type AssistantReply, type Citation, type SahayakDocument
} from "@sahayak/shared";
import { authenticator } from "./auth.js";
import { JSON_LIMIT, LIMITATIONS, REQUEST_TIMEOUT_MS, type Config } from "./config.js";
import { ApiError, checkAbort } from "./errors.js";
import { CATALOG_NOTICE, matchSchemes } from "./schemes.js";
import { DemoServices, type Services } from "./services.js";
import { MemoryStore, newStored, type DocumentStore, type StoredDocument } from "./store.js";
import { decodeUpload } from "./uploads.js";

const uploadRequest = z.object({ file: UploadSchema }).strict();
const uuid = z.string().uuid();

export class Api {
  private authenticate;
  constructor(private config: Config, private services: Services = new DemoServices(), private store: DocumentStore = new MemoryStore()) {
    this.authenticate = authenticator(config);
    if (config.mode === "azure" && services instanceof DemoServices) throw new Error("Azure mode cannot use demo services.");
  }
  async handle(request: Request): Promise<Response> {
    const requestId = randomUUID();
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId, "Vary": "Origin",
      "Access-Control-Expose-Headers": "X-Request-Id, ETag"
    });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    try {
      const origin = request.headers.get("origin");
      if (origin && origin !== this.config.corsOrigin) throw new ApiError(403, "CORS_ORIGIN", "This browser origin is not allowed.");
      if (origin) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Credentials", "true");
      }
      if (request.method === "OPTIONS") {
        headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
        headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Sahayak-Demo-Owner, If-Match");
        return this.response({ ok: true }, headers);
      }
      const path = new URL(request.url).pathname.replace(/\/$/, "");
      if (request.method === "GET" && path === "/api/health") return this.response({
        mode: this.config.mode,
        limitations: this.config.mode === "demo" ? [...LIMITATIONS, "Local unauthenticated demo: fictional data only; UTF-8 text parsing, English responses and device speech fallback. No Azure OCR, translation, STT, language detection or AI is called."] : LIMITATIONS
      }, headers);
      const owner = await this.authenticate(request.headers, headers);
      const result = await this.route(request, path, owner, headers, signal);
      await this.services.safe(textToScreen(result), signal);
      checkAbort(signal);
      return this.response(result, headers);
    } catch (error) {
      let failure: ApiError;
      if (signal.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)))
        failure = new ApiError(504, "REQUEST_TIMEOUT", "The operation timed out. Reload the document before retrying a write.");
      else if (error instanceof ApiError) failure = error;
      else failure = new ApiError(502, "SERVICE_ERROR", "The operation could not be completed. Please retry or check service configuration.");
      // No request bodies, paths, tokens, provider errors or document identifiers enter logs.
      if (failure.status >= 500) console.warn(JSON.stringify({ status: failure.status, code: failure.code, requestId }));
      if (failure.status === 401) headers.set("WWW-Authenticate", "Bearer");
      return this.response({ error: { code: failure.code, message: failure.message, requestId } }, headers, failure.status);
    }
  }
  private response(body: unknown, headers: Headers, status = 200) { return new Response(JSON.stringify(body), { status, headers }); }
  private async parse<T>(request: Request, schema: z.ZodType<T, z.ZodTypeDef, unknown>, signal: AbortSignal): Promise<T> {
    if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json"))
      throw new ApiError(415, "JSON_REQUIRED", "Use Content-Type: application/json.");
    if (Number(request.headers.get("content-length")) > JSON_LIMIT) throw new ApiError(413, "BODY_TOO_LARGE", "JSON body exceeds 9 MiB.");
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, "INVALID_JSON", "A JSON body is required.");
    const parts: Uint8Array[] = [];
    let length = 0;
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      for (;;) {
        checkAbort(signal);
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > JSON_LIMIT) {
          await reader.cancel();
          throw new ApiError(413, "BODY_TOO_LARGE", "JSON body exceeds 9 MiB.");
        }
        parts.push(value);
      }
      checkAbort(signal);
      let body: unknown;
      try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts))); }
      catch { throw new ApiError(400, "INVALID_JSON", "Request body must be valid UTF-8 JSON."); }
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new ApiError(400, "INVALID_REQUEST", "Request fields do not match the API schema or exceed allowed limits.");
      return parsed.data;
    } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
  }
  private async reply(text: string, language: string, signal: AbortSignal, citations: Citation[] = []): Promise<AssistantReply> {
    await this.services.safe(text, signal);
    return { id: randomUUID(), text, language, citations, speech: await this.services.speech(text, language, signal) };
  }
  private async localize(text: string, language: string, signal: AbortSignal) {
    return language === "en" ? text : this.services.translate(text, language, signal);
  }
  private assertVersion(request: Request, stored: StoredDocument) {
    const version = request.headers.get("if-match");
    if (version && version !== stored.version)
      throw new ApiError(409, "CONFLICT", "Your document version is stale. Reload it before editing.");
  }
  private async route(request: Request, path: string, owner: string, headers: Headers, signal: AbortSignal): Promise<unknown> {
    const method = request.method;
    if (path === "/api/languages" && method === "GET") return this.services.languages(signal);
    if (path === "/api/assistant" && method === "POST") {
      const input = await this.parse(request, ChatSchema, signal);
      await this.services.assertLanguage(input.language, signal);
      await this.services.safe(JSON.stringify({ message: input.message, history: input.history }), signal);
      const language = input.autoDetect ? await this.services.detect(input.message, input.language, signal) : input.language;
      const document = input.documentId ? (await this.store.get(owner, input.documentId, signal)).document : undefined;
      return this.reply(await this.services.chat(input, language, document, signal), language, signal);
    }
    if (path === "/api/speech/transcribe" && method === "POST") {
      const input = await this.parse(request, TranscribeSchema, signal);
      return this.services.transcribe(input.file, decodeUpload(input.file, "audio"), input.candidateLocales, signal);
    }
    if (path === "/api/schemes" && method === "POST") {
      const input = await this.parse(request, SchemeRequestSchema, signal);
      await this.services.assertLanguage(input.language, signal);
      await this.services.safe(JSON.stringify(input.profile), signal);
      const schemes = matchSchemes(input.profile);
      const summary = `${this.config.mode === "demo" ? "DEMO SAMPLE — " : ""}${CATALOG_NOTICE}\n${schemes.length ? schemes.map(scheme => `${scheme.title}: ${scheme.reason}${scheme.missingDetails.length ? ` Missing details: ${scheme.missingDetails.join(", ")}.` : ""}`).join("\n\n") : "No leads matched this limited illustrative catalog. This does not mean you are ineligible for assistance. Explore https://www.myscheme.gov.in/ for more programs."}`;
      const text = await this.localize(summary, input.language, signal);
      return { schemes, reply: await this.reply(text, input.language, signal, schemes.map(s => ({ title: s.title, url: s.officialUrl }))) };
    }
    if (path === "/api/documents" && method === "POST") {
      const { file } = await this.parse(request, uploadRequest, signal);
      const bytes = decodeUpload(file, "document");
      await this.services.safe(file.name, signal);
      const extracted = await this.services.extract(file, bytes, signal);
      if (!extracted.text.trim()) throw new ApiError(422, "NO_DOCUMENT_TEXT", "No readable text was found. Upload a clearer or text-based document.");
      const document: SahayakDocument = {
        id: randomUUID(), name: file.name, ...extracted, mode: this.config.mode,
        warnings: [
          this.config.mode === "demo" ? "DEMO: deterministic UTF-8 colon-field parsing only; no OCR or AI was called." : "OCR and AI extraction can be wrong. Compare every answer with the source.",
          "All extracted and suggested answers require review. Only a separate answer sheet can be exported.",
          "The app retains derived text for up to 24 hours, not original upload bytes."
        ]
      };
      await this.services.safe(textToScreen(document), signal);
      const stored = newStored(document);
      await this.store.put(owner, stored, undefined, signal);
      return document;
    }
    const match = /^\/api\/documents\/([^/]+)(?:\/(explain|translate|fill|fields|export))?$/.exec(path);
    if (!match) throw new ApiError(404, "ROUTE_NOT_FOUND", "API route not found.");
    if (!uuid.safeParse(match[1]).success) throw new ApiError(400, "INVALID_DOCUMENT_ID", "Document ID must be a UUID.");
    const id = match[1];
    const action = match[2];
    const current = await this.store.get(owner, id, signal);
    headers.set("ETag", current.version);
    if (!action && method === "GET") return current.document;
    if (!action && method === "DELETE") {
      this.assertVersion(request, current);
      await this.store.delete(owner, id, signal);
      return { deleted: true };
    }
    if ((action === "explain" || action === "translate") && method === "POST") {
      const { language } = await this.parse(request, LanguageRequestSchema, signal);
      await this.services.assertLanguage(language, signal);
      const text = action === "explain" ? await this.services.explain(current.document, language, signal)
        : await this.services.translate(current.document.text, language, signal);
      return this.reply(text, language, signal, [{ title: action === "translate" ? "Complete extracted text translation; original layout is not preserved" : "Uploaded document" }]);
    }
    if (action === "fill" && method === "POST") {
      const input = await this.parse(request, FillSchema, signal);
      this.assertVersion(request, current);
      await this.services.assertLanguage(input.language, signal);
      await this.services.safe(input.instruction, signal);
      const language = await this.services.detect(input.instruction, input.language, signal);
      const evidence = input.evidenceDocumentId ? (await this.store.get(owner, input.evidenceDocumentId, signal)).document : undefined;
      const suggestions = await this.services.fill(current.document, input.instruction, evidence, signal);
      const document = structuredClone(current.document);
      for (const suggestion of suggestions) {
        const field = document.fields.find(f => f.id === suggestion.id);
        if (field && !field.confirmed) Object.assign(field, { value: suggestion.value, source: suggestion.source, confirmed: false });
      }
      const summary = `${this.config.mode === "demo" ? "DEMO SAMPLE — " : ""}${suggestions.length} answer suggestion(s) added from supplied text or evidence. No confirmed answers were automatically changed. Review and confirm each nonempty answer before exporting a separate answer sheet.`;
      const reply = await this.reply(await this.localize(summary, language, signal), language, signal);
      await this.services.safe(textToScreen(document), signal);
      await this.store.put(owner, { ...current, document }, current.version, signal);
      headers.delete("ETag");
      return { document, reply };
    }
    if (action === "fields" && method === "PATCH") {
      const input = await this.parse(request, FieldsSchema, signal);
      this.assertVersion(request, current);
      if (new Set(input.fields.map(f => f.id)).size !== input.fields.length)
        throw new ApiError(400, "DUPLICATE_FIELD", "A field may only be included once per update.");
      const document = structuredClone(current.document);
      for (const patch of input.fields) {
        const field = document.fields.find(f => f.id === patch.id);
        if (!field) throw new ApiError(400, "UNKNOWN_FIELD", "Update refers to a field not present in this document.");
        const source = field.value === patch.value ? field.source : "User edited value";
        Object.assign(field, patch, { source });
      }
      await this.services.safe(textToScreen(document), signal);
      await this.store.put(owner, { ...current, document }, current.version, signal);
      headers.delete("ETag");
      return document;
    }
    if (action === "export" && method === "GET") {
      if (current.document.fields.some(field => field.value.trim() && !field.confirmed))
        throw new ApiError(409, "REVIEW_REQUIRED", "Confirm every nonempty answer before exporting.");
      const text = [
        "SAHAYAK — REVIEWED ANSWER SHEET",
        "This is not a filled, signed or submitted original application. Verify against the official form.",
        `Source: ${current.document.name}`,
        ...current.document.fields.map(field => `${field.label}: ${field.value || "[blank]"}`)
      ].join("\n");
      await this.services.safe(text, signal);
      return { fileName: `sahayak-answers-${id}.txt`, mimeType: "text/plain; charset=utf-8", base64: Buffer.from(text, "utf8").toString("base64") };
    }
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Method is not supported for this route.");
  }
}

// Screen human-readable output, never base64 audio or downloadable bytes (export is screened before encoding).
function textToScreen(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textToScreen).join("\n");
  if (value && typeof value === "object")
    return Object.entries(value).filter(([key]) => !["base64", "audioBase64", "id", "documentId"].includes(key)).map(([, item]) => textToScreen(item)).join("\n");
  return "";
}
