import { z } from "zod";
import { randomUUID } from "expo-crypto";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "http://localhost:7071/api").replace(/\/+$/, "");
let demoOwner: string | undefined;
export const healthSchema = z.object({ mode: z.enum(["demo", "azure"]), limitations: z.array(z.string()) });
export const languagesSchema = z.array(z.object({ code: z.string(), name: z.string(), nativeName: z.string() }));
export const replySchema = z.object({
  id: z.string(), text: z.string(), language: z.string(),
  speech: z.object({ mode: z.enum(["azure", "device", "unavailable"]), audioBase64: z.string().optional(), mimeType: z.string().optional(), error: z.string().optional() }),
  citations: z.array(z.object({ title: z.string(), url: z.string().optional() }))
});
export const documentSchema = z.object({
  id: z.string().uuid(), name: z.string(), text: z.string(),
  fields: z.array(z.object({ id: z.string(), label: z.string(), value: z.string(), confirmed: z.boolean(), source: z.string() })),
  warnings: z.array(z.string()), mode: z.enum(["demo", "azure"])
});
export const fillSchema = z.object({ reply: replySchema, document: documentSchema });
export const schemesSchema = z.object({
  reply: replySchema,
  schemes: z.array(z.object({ id: z.string(), title: z.string(), status: z.enum(["potential-match", "needs-details"]), reason: z.string(), officialUrl: z.string(), missingDetails: z.array(z.string()) }))
});
export const exportSchema = z.object({ fileName: z.string(), mimeType: z.string(), base64: z.string() });
export const transcriptionSchema = z.object({ text: z.string(), language: z.string(), locale: z.string() });
export const deletedSchema = z.object({ deleted: z.literal(true) });
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() }) });

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}
export async function request<T>(path: string, schema: z.ZodType<T>, token?: string, method = "GET", body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 165_000);
  try {
    if (!token && !demoOwner) demoOwner = randomUUID();
    const response = await fetch(`${API_URL}${path}`, {
      method, signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : { "x-sahayak-demo-owner": demoOwner || "" })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = errorSchema.safeParse(data);
      const message = parsed.success
        ? `${parsed.data.error.message}${parsed.data.error.requestId ? ` (Reference: ${parsed.data.error.requestId})` : ""}`
        : `The service returned HTTP ${response.status}. Please retry.`;
      throw new ApiError(response.status === 401 ? `Sign-in required or expired. ${message}` : message, response.status);
    }
    const result = schema.safeParse(data);
    if (!result.success) throw new ApiError("The service returned an unexpected response. Please check that the app and API versions match.");
    return result.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new ApiError("The request timed out. A write may have completed; reload your document before retrying.");
    throw new ApiError("Cannot reach Sahayak. Check your connection and API URL, then retry.");
  } finally {
    clearTimeout(timeout);
  }
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
