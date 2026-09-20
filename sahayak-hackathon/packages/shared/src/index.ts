import { z } from "zod";

export const MAX_FILE_BYTES = 6 * 1024 * 1024;
export const MAX_DOCUMENT_CHARS = 40000;
export const LanguageSchema = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/).max(24);
export const UploadSchema = z.object({
  name: z.string().min(1).max(160),
  mimeType: z.string().min(1).max(100),
  base64: z.string().min(4).max(Math.ceil(MAX_FILE_BYTES / 3) * 4)
}).strict();
export type Upload = z.infer<typeof UploadSchema>;

export const ProfileSchema = z.object({
  age: z.number().int().min(0).max(120).optional(),
  annualIncome: z.number().min(0).max(1e10).optional(),
  state: z.string().trim().max(80).optional(),
  occupation: z.enum(["student", "farmer", "self-employed", "employed", "unemployed", "other"]).optional(),
  ownsFarmland: z.boolean().optional()
}).strict();
export type Profile = z.infer<typeof ProfileSchema>;

export const ChatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  language: LanguageSchema.default("en"),
  autoDetect: z.boolean().default(true),
  documentId: z.string().uuid().optional(),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    text: z.string().max(8000)
  }).strict()).max(12).default([])
}).strict();
export type ChatRequest = z.infer<typeof ChatSchema>;

export const LanguageRequestSchema = z.object({ language: LanguageSchema }).strict();
export const FillSchema = z.object({
  instruction: z.string().trim().min(1).max(4000),
  language: LanguageSchema.default("en"),
  evidenceDocumentId: z.string().uuid().optional()
}).strict();
export const FieldsSchema = z.object({
  fields: z.array(z.object({
    id: z.string().min(1).max(100),
    value: z.string().max(2000),
    confirmed: z.boolean()
  }).strict()).max(80)
}).strict();
export const SchemeRequestSchema = z.object({
  profile: ProfileSchema,
  language: LanguageSchema.default("en")
}).strict();
export const TranscribeSchema = z.object({
  file: UploadSchema,
  candidateLocales: z.array(z.string().regex(/^[a-z]{2,3}-[A-Z]{2}$/)).min(1).max(4).optional()
}).strict();

export interface SpeechAttachment {
  mode: "azure" | "device" | "unavailable";
  audioBase64?: string;
  mimeType?: string;
  error?: string;
}
export interface Citation { title: string; url?: string }
export interface AssistantReply {
  id: string;
  text: string;
  language: string;
  speech: SpeechAttachment;
  citations: Citation[];
}
export interface FormField {
  id: string;
  label: string;
  value: string;
  confirmed: boolean;
  source: string;
}
export interface SahayakDocument {
  id: string;
  name: string;
  text: string;
  fields: FormField[];
  warnings: string[];
  mode: "demo" | "azure";
}
export interface SchemeMatch {
  id: string;
  title: string;
  status: "potential-match" | "needs-details";
  reason: string;
  officialUrl: string;
  missingDetails: string[];
}
export interface SchemeResponse { reply: AssistantReply; schemes: SchemeMatch[] }
export interface FillResponse { reply: AssistantReply; document: SahayakDocument }
export interface ExportResponse { fileName: string; mimeType: string; base64: string }
export interface LanguageOption { code: string; name: string; nativeName: string }
export interface HealthResponse {
  mode: "demo" | "azure";
  limitations: string[];
}
export interface TranscriptionResponse { text: string; language: string; locale: string }
export interface ApiErrorResponse { error: { code: string; message: string; requestId: string } }

export const DEMO_LANGUAGES: LanguageOption[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "hi", name: "Hindi", nativeName: "Hindi" },
  { code: "te", name: "Telugu", nativeName: "Telugu" },
  { code: "ta", name: "Tamil", nativeName: "Tamil" },
  { code: "kn", name: "Kannada", nativeName: "Kannada" },
  { code: "ml", name: "Malayalam", nativeName: "Malayalam" },
  { code: "mr", name: "Marathi", nativeName: "Marathi" },
  { code: "bn", name: "Bengali", nativeName: "Bengali" },
  { code: "gu", name: "Gujarati", nativeName: "Gujarati" },
  { code: "pa", name: "Punjabi", nativeName: "Punjabi" },
  { code: "ur", name: "Urdu", nativeName: "Urdu" },
  { code: "ar", name: "Arabic", nativeName: "Arabic" },
  { code: "es", name: "Spanish", nativeName: "Spanish" },
  { code: "fr", name: "French", nativeName: "French" },
  { code: "de", name: "German", nativeName: "German" }
];

export const SAMPLE_FORM = [
  "SAHAYAK DEMONSTRATION APPLICATION - NOT AN OFFICIAL GOVERNMENT FORM",
  "Applicant name:",
  "Age:",
  "State:",
  "Occupation:",
  "Annual household income:",
  "Address:",
  "Purpose of assistance:",
  "",
  "Use fictional details only. Review all answers before exporting."
].join("\n");
