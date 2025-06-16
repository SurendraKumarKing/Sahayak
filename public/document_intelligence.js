import { AZURE_DOCUMENT_INTELLIGENCE_KEY, AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT } from "./config.js";

export async function analyzeDocument(file) {
  console.log("analyzeDocument: Processing document:", file.name);
  try {
    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: file.type });

    // Prepare form data for Document Intelligence
    const formData = new FormData();
    formData.append("file", blob, file.name);

    // Call Azure Document Intelligence API (prebuilt-read model)
    const response = await fetch(`${AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-02-29-preview`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": AZURE_DOCUMENT_INTELLIGENCE_KEY
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Document Intelligence API error: ${response.statusText}`);
    }

    // Get operation location
    const operationLocation = response.headers.get("Operation-Location");
    if (!operationLocation) {
      throw new Error("No operation location returned by Document Intelligence API");
    }

    // Poll for result
    let result;
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
      const resultResponse = await fetch(operationLocation, {
        headers: {
          "Ocp-Apim-Subscription-Key": AZURE_DOCUMENT_INTELLIGENCE_KEY
        }
      });
      result = await resultResponse.json();
      if (result.status === "succeeded") {
        break;
      }
    }

    if (result.status !== "succeeded") {
      throw new Error("Document Intelligence analysis failed to complete");
    }

    // Extract text from result
    let text = "";
    if (result.analyzeResult && result.analyzeResult.content) {
      text = result.analyzeResult.content;
    }

    console.log("analyzeDocument: Extracted text:", text);
    return text.trim() || `Document ${file.name} processed, but no text extracted.`;
  } catch (error) {
    console.error("analyzeDocument: Error:", error);
    return `Error processing document: ${error.message}`;
  }
}