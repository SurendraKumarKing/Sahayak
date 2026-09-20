import test from "node:test";
import assert from "node:assert/strict";
import { DefaultAzureCredential } from "@azure/identity";
import { AzureServices } from "./azure.js";
import type { Config } from "./config.js";

const config: Config = {
  mode: "azure", corsOrigin: "http://localhost:8081",
  values: {
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://doc.example.test",
    AZURE_OPENAI_ENDPOINT: "https://openai.example.test",
    AZURE_OPENAI_DEPLOYMENT: "chat",
    AZURE_TRANSLATOR_ENDPOINT: "https://translator.example.test",
    AZURE_LANGUAGE_ENDPOINT: "https://language.example.test",
    AZURE_SPEECH_ENDPOINT: "https://speech.example.test",
    AZURE_SPEECH_RESOURCE_ID: "/subscriptions/example/resourceGroups/demo/providers/Microsoft.CognitiveServices/accounts/speech",
    AZURE_CONTENT_SAFETY_ENDPOINT: "https://safety.example.test"
  }
};
const signal = () => new AbortController().signal;
const json = (value: unknown) => Response.json(value);

test("Azure translation uses keyless custom-domain routes and preserves complete chunk order", async t => {
  const credential = new DefaultAzureCredential();
  t.mock.method(credential, "getToken", async () => ({ token: "mock-access-token", expiresOnTimestamp: Date.now() + 60000 }));
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    assert.match(new Headers(init?.headers).get("authorization") || "", /^Bearer mock-access-token$/);
    if (url.pathname.endsWith("/languages")) return json({ translation: { hi: { name: "Hindi", nativeName: "Hindi" } } });
    assert.equal(url.pathname, "/translator/text/v3.0/translate");
    assert.equal(url.searchParams.get("to"), "hi");
    const data: unknown = JSON.parse(String(init?.body));
    assert.ok(Array.isArray(data));
    const first: unknown = data[0];
    assert.ok(first && typeof first === "object" && "Text" in first && typeof first.Text === "string");
    assert.ok(first.Text.length <= 5000);
    return json([{ translations: [{ text: first.Text, to: "hi" }] }]);
  });
  const service = new AzureServices(config, credential);
  const text = "Example sentence. \n".repeat(700);
  assert.equal(await service.translate(text, "hi", signal()), text);
  assert.ok(requests.filter(path => path.endsWith("/translate")).length > 1);
  await assert.rejects(service.translate(text, "xx", signal()), { code: "UNSUPPORTED_LANGUAGE" });
});

test("Azure detection retains previous language at low confidence and switches at high confidence", async t => {
  const credential = new DefaultAzureCredential();
  t.mock.method(credential, "getToken", async () => ({ token: "mock-access-token", expiresOnTimestamp: Date.now() + 60000 }));
  let confidence = 0.3;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/languages")) return json({ translation: { te: { name: "Telugu", nativeName: "Telugu" } } });
    assert.equal(url.pathname, "/language/:analyze-text");
    return json({ results: { documents: [{ detectedLanguage: { iso6391Name: "te", confidenceScore: confidence } }], errors: [] } });
  });
  const service = new AzureServices(config, credential);
  assert.equal(await service.detect("short", "en", signal()), "en");
  confidence = 0.99;
  assert.equal(await service.detect("clear Telugu input", "en", signal()), "te");
});

test("Speech sends candidate locales as multipart and retains uncertainty for mixed-language clips", async t => {
  const credential = new DefaultAzureCredential();
  t.mock.method(credential, "getToken", async () => ({ token: "mock-access-token", expiresOnTimestamp: Date.now() + 60000 }));
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(new URL(String(input)).pathname, "/speechtotext/transcriptions:transcribe");
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("definition"), JSON.stringify({ locales: ["kn-IN", "en-IN"] }));
    assert.ok(init.body.get("audio") instanceof Blob);
    return json({ combinedPhrases: [{ text: "A multilingual transcript" }], phrases: [{ locale: "kn-IN" }, { locale: "en-IN" }] });
  });
  const service = new AzureServices(config, credential);
  const result = await service.transcribe({ name: "voice.m4a", mimeType: "audio/mp4", base64: "YWJj" }, Buffer.from("abc"), ["kn-IN", "en-IN"], signal());
  assert.deepEqual(result, { text: "A multilingual transcript", language: "und", locale: "und" });
});

test("TTS attaches MP3 and exposes an explicit device fallback instead of losing text", async t => {
  const credential = new DefaultAzureCredential();
  t.mock.method(credential, "getToken", async () => ({ token: "mock-access-token", expiresOnTimestamp: Date.now() + 60000 }));
  let syntheses = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer aad#${config.values.AZURE_SPEECH_RESOURCE_ID}#mock-access-token`);
    if (url.pathname.endsWith("/voices/list")) return json([{ ShortName: "en-IN-NeerjaNeural", Locale: "en-IN", VoiceType: "Neural" }]);
    assert.equal(url.pathname, "/tts/cognitiveservices/v1");
    assert.match(String(init?.body), /A &amp; B &lt; C/);
    syntheses++;
    return new Response(new Uint8Array([73, 68, 51]));
  });
  const service = new AzureServices(config, credential);
  const voice = await service.speech("A & B < C", "en", signal());
  assert.equal(voice.mode, "azure");
  assert.equal(voice.audioBase64, "SUQz");
  assert.equal((await service.speech("x".repeat(3001), "en", signal())).mode, "device");
  assert.equal((await service.speech("example", "xx", signal())).mode, "device");
  assert.equal(syntheses, 1);
});
