import { AZURE_COMPUTER_VISION_KEY, AZURE_COMPUTER_VISION_ENDPOINT } from "../config.js";

export async function analyzeImage(file) {
  console.log("analyzeImage: Processing image:", file.name, "Size:", file.size, "Type:", file.type);
  try {
    // Validate file
    if (!file.type.startsWith("image/")) {
      throw new Error("Invalid file type. Please upload an image.");
    }
    if (file.size > 50 * 1024 * 1024) { // 50MB limit
      throw new Error("Image size exceeds 50MB limit.");
    }

    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: file.type });

    // Prepare form data for OCR
    const formData = new FormData();
    formData.append("file", blob, file.name);

    // Call Azure Computer Vision Read API
    console.log("analyzeImage: Sending request to Computer Vision API");
    const response = await fetch(`${AZURE_COMPUTER_VISION_ENDPOINT}/vision/v3.2/read/analyze?language=und`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": AZURE_COMPUTER_VISION_KEY
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("analyzeImage: API response error:", response.status, errorText);
      throw new Error(`Computer Vision API error: ${response.status} - ${errorText}`);
    }

    // Get operation location
    const operationLocation = response.headers.get("Operation-Location");
    if (!operationLocation) {
      console.error("analyzeImage: No operation location returned");
      throw new Error("No operation location returned by Computer Vision API");
    }
    console.log("analyzeImage: Operation location:", operationLocation);

    // Poll for result
    let result;
    const maxAttempts = 15;
    const pollInterval = 1000; // 1s
    for (let i = 0; i < maxAttempts; i++) {
      console.log(`analyzeImage: Polling attempt ${i + 1}/${maxAttempts}`);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      const resultResponse = await fetch(operationLocation, {
        headers: {
          "Ocp-Apim-Subscription-Key": AZURE_COMPUTER_VISION_KEY
        }
      });
      if (!resultResponse.ok) {
        const errorText = await resultResponse.text();
        console.error("analyzeImage: Polling error:", resultResponse.status, errorText);
        throw new Error(`Polling error: ${resultResponse.status} - ${errorText}`);
      }
      result = await resultResponse.json();
      console.log("analyzeImage: Polling status:", result.status);
      if (result.status === "succeeded") {
        break;
      }
      if (result.status === "failed") {
        console.error("analyzeImage: OCR failed:", result);
        throw new Error("Computer Vision OCR failed");
      }
    }

    if (result.status !== "succeeded") {
      console.error("analyzeImage: OCR did not succeed after", maxAttempts, "attempts");
      throw new Error("Computer Vision OCR failed to complete within allotted time");
    }

    // Extract text from result
    let text = "";
    if (result.analyzeResult && result.analyzeResult.readResults) {
      for (const page of result.analyzeResult.readResults) {
        for (const line of page.lines) {
          text += line.text + " ";
        }
      }
    } else {
      console.warn("analyzeImage: No readResults in response:", result);
    }

    const finalText = text.trim() || `Image ${file.name} processed, but no text detected.`;
    console.log("analyzeImage: Extracted text:", finalText);
    return finalText;
  } catch (error) {
    console.error("analyzeImage: Error:", error.message);
    return `Error processing image: ${error.message}. Please ensure the image is valid and try again.`;
  }
}