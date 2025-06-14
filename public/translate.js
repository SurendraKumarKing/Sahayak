import { AZURE_TRANSLATOR_KEY, AZURE_TRANSLATOR_ENDPOINT, AZURE_TRANSLATOR_REGION } from "./config.js";

export async function detectLanguage(text) {
  const res = await fetch(`${AZURE_TRANSLATOR_ENDPOINT}/detect?api-version=3.0`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": AZURE_TRANSLATOR_KEY,
      "Ocp-Apim-Subscription-Region": AZURE_TRANSLATOR_REGION,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([{ Text: text }])
  });
  const data = await res.json();
  return data?.[0]?.language || "en";
}

export async function translateText(text, from, to) {
  const res = await fetch(`${AZURE_TRANSLATOR_ENDPOINT}/translate?api-version=3.0&from=${from}&to=${to}`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": AZURE_TRANSLATOR_KEY,
      "Ocp-Apim-Subscription-Region": AZURE_TRANSLATOR_REGION,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([{ Text: text }])
  });
  const data = await res.json();
  return data?.[0]?.translations?.[0]?.text || text;
}
