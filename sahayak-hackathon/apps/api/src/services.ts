import type { ChatRequest, FormField, LanguageOption, SahayakDocument, SpeechAttachment, TranscriptionResponse, Upload } from "@sahayak/shared";
import { colonFields, decodeText } from "./uploads.js";
import { checkAbort, unsupported } from "./errors.js";

export interface Suggestion { id: string; value: string; source: string }
export interface Services {
  languages(signal: AbortSignal): Promise<LanguageOption[]>;
  assertLanguage(language: string, signal: AbortSignal): Promise<void>;
  safe(text: string, signal: AbortSignal): Promise<void>;
  detect(text: string, previous: string, signal: AbortSignal): Promise<string>;
  extract(file: Upload, bytes: Buffer, signal: AbortSignal): Promise<{ text: string; fields: FormField[] }>;
  chat(input: ChatRequest, language: string, document: SahayakDocument | undefined, signal: AbortSignal): Promise<string>;
  explain(document: SahayakDocument, language: string, signal: AbortSignal): Promise<string>;
  translate(text: string, language: string, signal: AbortSignal): Promise<string>;
  fill(document: SahayakDocument, instruction: string, evidence: SahayakDocument | undefined, signal: AbortSignal): Promise<Suggestion[]>;
  speech(text: string, language: string, signal: AbortSignal): Promise<SpeechAttachment>;
  transcribe(file: Upload, bytes: Buffer, locales: string[] | undefined, signal: AbortSignal): Promise<TranscriptionResponse>;
}
export class DemoServices implements Services {
  async languages(): Promise<LanguageOption[]> { return [{ code: "en", name: "English (demo only)", nativeName: "English" }]; }
  async assertLanguage(language: string) {
    if (language !== "en") unsupported("Demo supports English only. Configure Azure mode for language detection and translation.");
  }
  async safe(_text: string, signal: AbortSignal) {
    // Demo has no moderation provider; never imply this is an Azure safety check.
    checkAbort(signal);
  }
  async detect(_text: string, previous: string) { return previous; }
  async extract(file: Upload, bytes: Buffer) {
    if (file.mimeType !== "text/plain") unsupported("Demo reads UTF-8 .txt files only. Configure Azure Document Intelligence for PDF/image OCR.");
    const text = decodeText(bytes);
    return { text, fields: colonFields(text) };
  }
  async chat(input: ChatRequest, _language: string, document?: SahayakDocument) {
    return `DEMO SAMPLE — no Azure AI was called. ${document ? `Your selected document has ${document.fields.length} colon-delimited fields. ` : ""}Use Schemes to explore official program links, or upload a UTF-8 text form. To suggest answers, supply exact “Label: value” lines under Fill; review each value before exporting an answer sheet. This demo does not understand general questions or detect conversation languages. Your message was received (${input.message.length} characters).`;
  }
  async explain(document: SahayakDocument) {
    return `DEMO SAMPLE — deterministic form overview, not an AI explanation. ${document.fields.length ? `Detected labels: ${document.fields.map(f => f.label).join(", ")}.` : "No colon-delimited field labels were found."} Supply exact “Label: value” lines, review all suggested answers, then export a separate UTF-8 answer sheet. The original document is not edited.`;
  }
  async translate(_text: string, _language: string): Promise<string> {
    return unsupported("Demo does not translate or verify the source language. Configure Azure Translator to translate complete extracted text.");
  }
  async fill(document: SahayakDocument, instruction: string, evidence?: SahayakDocument) {
    const provided = colonFields(instruction);
    const evidenceFields = evidence ? colonFields(evidence.text) : [];
    return document.fields.filter(f => !f.confirmed).flatMap(field => {
      const direct = provided.find(f => f.label.toLowerCase() === field.label.toLowerCase());
      const proof = evidenceFields.find(f => f.label.toLowerCase() === field.label.toLowerCase());
      const match = direct || proof;
      return match?.value ? [{ id: field.id, value: match.value, source: direct ? "Exact Label: value supplied by user" : `Exact Label: value in evidence document ${evidence!.id}` }] : [];
    });
  }
  async speech(): Promise<SpeechAttachment> {
    return { mode: "device", error: "Demo: Azure Speech was not called. Device speech is optional and depends on installed voices." };
  }
  async transcribe(): Promise<TranscriptionResponse> {
    return unsupported("Demo cannot transcribe audio. Type text, use your device keyboard dictation, or configure Azure Speech.");
  }
}
