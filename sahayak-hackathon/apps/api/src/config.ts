export interface Config {
  mode: "demo" | "azure";
  corsOrigin: string;
  values: Record<string, string>;
}

export const JSON_LIMIT = 9 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 150_000;
export const TTL_MS = 24 * 60 * 60 * 1000;
export const LIMITATIONS = [
  "Starter only: scheme catalog is illustrative and must be maintained before real use; matches are not eligibility decisions.",
  "Review all suggested answers. Export is a UTF-8 answer sheet, not an edited or signed original PDF.",
  "Derived documents expire after 24 hours. Original upload bytes are not retained by this application.",
  "Twilio, DigiLocker, private networking, application submission and legal verification are out of scope."
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = env.SAHAYAK_MODE ?? "demo";
  if (mode !== "demo" && mode !== "azure") throw new Error("SAHAYAK_MODE must be demo or azure.");
  if (env.WEBSITE_HOSTNAME && mode !== "azure") throw new Error("Hosted deployments require explicit SAHAYAK_MODE=azure.");
  const values: Record<string, string> = {};
  const required = [
    "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "AZURE_TRANSLATOR_ENDPOINT", "AZURE_LANGUAGE_ENDPOINT",
    "AZURE_SPEECH_ENDPOINT", "AZURE_SPEECH_REGION", "AZURE_SPEECH_RESOURCE_ID", "AZURE_CONTENT_SAFETY_ENDPOINT",
    "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT", "AZURE_STORAGE_ACCOUNT_URL",
    "ENTRA_TENANT_ID", "ENTRA_API_AUDIENCE"
  ];
  if (mode === "azure") {
    for (const key of required) {
      const value = env[key]?.trim();
      if (!value) throw new Error(`Missing required Azure configuration: ${key}`);
      values[key] = value;
      if (key.endsWith("_ENDPOINT") || key === "AZURE_STORAGE_ACCOUNT_URL") {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
          throw new Error(`${key} must be an HTTPS resource origin, without path or credentials.`);
      }
    }
    if (!/^[0-9a-f-]{36}$/i.test(values.ENTRA_TENANT_ID)) throw new Error("ENTRA_TENANT_ID must be a tenant UUID.");
  }
  values.AZURE_STORAGE_CONTAINER = env.AZURE_STORAGE_CONTAINER || "sahayak";
  values.ENTRA_REQUIRED_SCOPE = env.ENTRA_REQUIRED_SCOPE || "access_as_user";
  const corsOrigin = env.API_CORS_ORIGIN || "http://localhost:8081";
  const corsUrl = new URL(corsOrigin);
  if (!["http:", "https:"].includes(corsUrl.protocol) || corsUrl.origin !== corsOrigin)
    throw new Error("API_CORS_ORIGIN must be one exact HTTP(S) origin.");
  return { mode, corsOrigin, values };
}
