import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MAX_DOCUMENT_CHARS, SAMPLE_FORM, ChatSchema, FieldsSchema, ProfileSchema, UploadSchema } from "@sahayak/shared";
import { Api } from "./app.js";
import { authenticator } from "./auth.js";
import { JSON_LIMIT, loadConfig, TTL_MS } from "./config.js";
import { DemoServices } from "./services.js";
import { MemoryStore, newStored } from "./store.js";
import { chunks, colonFields, decodeUpload } from "./uploads.js";
import { matchSchemes } from "./schemes.js";

const owner = randomUUID();
const config = loadConfig({ SAHAYAK_MODE: "demo" });
function fixture(store = new MemoryStore()) {
  const api = new Api(config, new DemoServices(), store);
  return async (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) => {
    const response = await api.handle(new Request(`http://localhost/api${path}`, {
      method, headers: { "content-type": "application/json", "x-sahayak-demo-owner": owner, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    }));
    return { response, body: await response.json() as any };
  };
}
function textFile(text: string) { return { name: "fictional-form.txt", mimeType: "text/plain", base64: Buffer.from(text).toString("base64") }; }

test("demo health, languages, assistant and explanation accurately label capabilities", async () => {
  const call = fixture();
  assert.equal((await call("/health")).body.mode, "demo");
  assert.deepEqual((await call("/languages")).body.map((l: any) => l.code), ["en"]);
  const chat = await call("/assistant", "POST", { message: "How can I apply?" });
  assert.equal(chat.response.status, 200);
  assert.match(chat.body.text, /DEMO SAMPLE/);
  assert.equal(chat.body.speech.mode, "device");
  const document = (await call("/documents", "POST", { file: textFile(SAMPLE_FORM) })).body;
  assert.equal(document.fields.length, 7);
  const explanation = await call(`/documents/${document.id}/explain`, "POST", { language: "en" });
  assert.equal(explanation.body.speech.mode, "device");
  assert.match(explanation.body.text, /deterministic/);
});

test("fill uses supplied exact values, preserves confirmed fields and requires review for export", async () => {
  const call = fixture();
  const original = await call("/documents", "POST", { file: textFile("Name:\nAge:\nState:") });
  const id = original.body.id;
  const fill = await call(`/documents/${id}/fill`, "POST", { instruction: "Name: Fictional Ada\nAge: 31\nState: Example", language: "en" });
  assert.equal(fill.response.status, 200);
  assert.equal(fill.body.document.fields[0].value, "Fictional Ada");
  assert.equal(fill.body.document.fields[0].confirmed, false);
  assert.equal((await call(`/documents/${id}/export`)).response.status, 409);
  const fields = fill.body.document.fields.map((f: any) => ({ id: f.id, value: f.value, confirmed: true }));
  assert.equal((await call(`/documents/${id}/fields`, "PATCH", { fields })).response.status, 200);
  const retry = await call(`/documents/${id}/fill`, "POST", { instruction: "Name: Not Ada", language: "en" });
  assert.equal(retry.body.document.fields[0].value, "Fictional Ada");
  const exported = await call(`/documents/${id}/export`);
  assert.equal(exported.response.status, 200);
  assert.match(Buffer.from(exported.body.base64, "base64").toString(), /Name: Fictional Ada/);
  assert.match(exported.body.mimeType, /text\/plain/);
  assert.match(Buffer.from(exported.body.base64, "base64").toString(), /not a filled, signed or submitted/);
});

test("evidence uploads can supply exact values and are owner-scoped", async () => {
  const call = fixture();
  const doc = (await call("/documents", "POST", { file: textFile("Name:\nAge:") })).body;
  const evidence = (await call("/documents", "POST", { file: textFile("Name: Fictional Evidence\nAge: 20") })).body;
  const filled = await call(`/documents/${doc.id}/fill`, "POST", { instruction: "Use supplied evidence", evidenceDocumentId: evidence.id });
  assert.equal(filled.body.document.fields[0].value, "Fictional Evidence");
  assert.match(filled.body.document.fields[0].source, new RegExp(evidence.id));
  assert.equal((await call(`/documents/${doc.id}`, "GET", undefined, { "x-sahayak-demo-owner": randomUUID() })).response.status, 404);
  assert.equal((await call(`/documents/${doc.id}/fill`, "POST", { instruction: "Use evidence", evidenceDocumentId: randomUUID() })).response.status, 404);
});

test("unknown IDs, invalid UUIDs, deletion and review field validation", async () => {
  const call = fixture();
  assert.equal((await call(`/documents/${randomUUID()}`)).response.status, 404);
  assert.equal((await call("/documents/not-a-uuid")).response.status, 400);
  const doc = (await call("/documents", "POST", { file: textFile("Name:") })).body;
  assert.equal((await call(`/documents/${doc.id}/fields`, "PATCH", { fields: [{ id: "unknown", value: "X", confirmed: true }] })).response.status, 400);
  const field = { id: "field-1", value: "X", confirmed: true };
  assert.equal((await call(`/documents/${doc.id}/fields`, "PATCH", { fields: [field, field] })).response.status, 400);
  const get = await call(`/documents/${doc.id}`);
  const etag = get.response.headers.get("etag")!;
  await call(`/documents/${doc.id}/fields`, "PATCH", { fields: [field] });
  assert.equal((await call(`/documents/${doc.id}/fields`, "PATCH", { fields: [field] }, { "if-match": etag })).response.status, 409);
  assert.deepEqual((await call(`/documents/${doc.id}`, "DELETE")).body, { deleted: true });
  assert.equal((await call(`/documents/${doc.id}`)).response.status, 404);
});

test("demo explicitly rejects fake OCR, speech transcription and translation", async () => {
  const call = fixture();
  const pdf = { name: "test.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-1.7\nfictional").toString("base64") };
  assert.equal((await call("/documents", "POST", { file: pdf })).response.status, 501);
  const wave = Buffer.alloc(44); wave.write("RIFF"); wave.write("WAVE", 8);
  const audio = { name: "test.wav", mimeType: "audio/wav", base64: wave.toString("base64") };
  assert.equal((await call("/speech/transcribe", "POST", { file: audio })).response.status, 501);
  const doc = (await call("/documents", "POST", { file: textFile("Name:") })).body;
  assert.equal((await call(`/documents/${doc.id}/translate`, "POST", { language: "en" })).response.status, 501);
  assert.equal((await call("/assistant", "POST", { message: "hello", language: "hi" })).response.status, 501);
});

test("upload size, text size, field count, MIME, canonical base64 and UTF8 limits are enforced", async () => {
  const call = fixture();
  assert.equal((await call("/documents", "POST", { file: textFile("x".repeat(MAX_DOCUMENT_CHARS + 1)) })).response.status, 413);
  assert.equal((await call("/documents", "POST", { file: textFile(Array.from({ length: 81 }, (_, i) => `Field${i}:`).join("\n")) })).response.status, 413);
  assert.equal((await call("/documents", "POST", { file: { ...textFile("Name:"), mimeType: "image/png" } })).response.status, 415);
  assert.equal((await call("/documents", "POST", { file: { ...textFile("Name:"), base64: "!!!!" } })).response.status, 400);
  assert.equal((await call("/documents", "POST", { file: { ...textFile("Name:"), base64: "/w==" } })).response.status, 415);
  assert.equal((await call("/documents", "POST", { file: textFile(" ") })).response.status, 422);
  assert.equal((await call("/assistant", "POST", { message: "x", extra: true })).response.status, 400);
  const tooBig = await call("/assistant", "POST", { message: "x" }, { "content-length": String(JSON_LIMIT + 1) });
  assert.equal(tooBig.response.status, 413);
  assert.throws(() => decodeUpload({ ...textFile("Name:"), base64: "Zh==" }, "document"));
  assert.throws(() => colonFields(`Name: ${"x".repeat(2001)}`));
});

test("schemas distinguish missing values from false and reject invalid fields", () => {
  assert.equal(ProfileSchema.parse({ ownsFarmland: false }).ownsFarmland, false);
  assert.equal(ProfileSchema.parse({}).ownsFarmland, undefined);
  assert.equal(ProfileSchema.safeParse({ ownsFarmland: null }).success, false);
  assert.equal(ChatSchema.safeParse({ message: "", history: [] }).success, false);
  assert.equal(FieldsSchema.safeParse({ fields: [{ id: "a", value: "x", confirmed: "true" }] }).success, false);
  assert.equal(UploadSchema.safeParse({ name: "x", mimeType: "text/plain", base64: "eA==", url: "https://example.com" }).success, false);
});

test("scheme matching reports missing data without asserting eligibility", async () => {
  const matches = matchSchemes({});
  assert.ok(matches.length > 0);
  assert.ok(matches.every(match => match.status === "needs-details" && match.missingDetails.length));
  assert.equal(matchSchemes({ occupation: "farmer", ownsFarmland: false }).some(m => m.id === "pm-kisan"), false);
  assert.equal(matchSchemes({ occupation: "farmer", ownsFarmland: true, state: "Example", annualIncome: 0 }).find(m => m.id === "pm-kisan")?.status, "potential-match");
  assert.equal(matchSchemes({ occupation: "employed", ownsFarmland: false }).length, 0);
  const result = await fixture()("/schemes", "POST", { profile: {}, language: "en" });
  assert.match(result.body.reply.text, /not an eligibility decision/);
  assert.equal(result.body.reply.speech.mode, "device");
});

test("memory TTL, caps and compare-and-swap reject expired or conflicting state", async () => {
  let now = Date.now();
  const store = new MemoryStore(2, 1, () => now);
  const signal = new AbortController().signal;
  const doc = { id: randomUUID(), name: "a.txt", text: "Name:", fields: [], warnings: [], mode: "demo" as const };
  await store.put("a", newStored(doc), undefined, signal);
  const loaded = await store.get("a", doc.id, signal);
  await assert.rejects(store.put("a", newStored({ ...doc, id: randomUUID() }), undefined, signal), (e: any) => e.status === 429);
  await assert.rejects(store.put("a", loaded, "stale", signal), (e: any) => e.status === 409);
  await store.put("a", loaded, loaded.version, signal);
  await assert.rejects(store.put("a", loaded, loaded.version, signal), (e: any) => e.status === 409);
  now += TTL_MS + 1;
  await assert.rejects(store.get("a", doc.id, signal), (e: any) => e.status === 404);
});

test("CORS permits one origin and rejects other origins; cookies scope browser demos", async () => {
  const call = fixture();
  assert.equal((await call("/health", "GET", undefined, { origin: "https://evil.example" })).response.status, 403);
  const preflight = await call("/documents", "OPTIONS", undefined, { origin: "http://localhost:8081" });
  assert.equal(preflight.response.status, 200);
  assert.equal(preflight.response.headers.get("access-control-allow-origin"), "http://localhost:8081");
  const api = new Api(config);
  const first = await api.handle(new Request("http://localhost/api/languages"));
  assert.match(first.headers.get("set-cookie")!, /HttpOnly/);
});

test("Azure auth rejects missing/invalid bearer without trusting injected platform principal", async () => {
  const azureConfig = {
    mode: "azure" as const, corsOrigin: "http://localhost:8081",
    values: { ENTRA_TENANT_ID: "00000000-0000-0000-0000-000000000001", ENTRA_API_AUDIENCE: "test-audience", ENTRA_REQUIRED_SCOPE: "access_as_user" }
  };
  const authenticate = authenticator(azureConfig);
  await assert.rejects(authenticate(new Headers({ "x-ms-client-principal": "pretend-authenticated" }), new Headers()), (e: any) => e.status === 401);
  await assert.rejects(authenticate(new Headers({ authorization: "Bearer not-a-jwt" }), new Headers()), (e: any) => e.status === 401);
});

test("hosted demo and incomplete Azure configuration fail closed", () => {
  assert.throws(() => loadConfig({ WEBSITE_HOSTNAME: "example.azurewebsites.net" }), /require explicit/);
  assert.throws(() => loadConfig({ SAHAYAK_MODE: "azure" }), /Missing required/);
  assert.throws(() => loadConfig({ SAHAYAK_MODE: "invalid" }), /must be/);
});

test("chunking is bounded and lossless across unicode and sentence boundaries", () => {
  const text = "Sentence one. \n" + "😀".repeat(20000) + "\nEnd.";
  const parts = chunks(text, 5000);
  assert.equal(parts.join(""), text);
  assert.ok(parts.every(part => part.length <= 5000));
  assert.ok(parts.every(part => !/[\uD800-\uDBFF]$/.test(part)));
});
