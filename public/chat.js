import { detectLanguage, translateText } from "./translate.js";
import { analyzeDocument } from "./document_intelligence.js";
import { AZURE_OPENAI_KEY, AZURE_OPENAI_ENDPOINT, DEPLOYMENT_NAME, API_VERSION, BACKEND_URL } from "./config.js";

// Store the user's language globally
let userLanguage = "en";

// Supported languages
const supportedLanguages = ['en', 'hi', 'pa', 'kn', 'te', 'ta', 'ml'];

// Common English greetings to force English detection
const englishGreetings = ['hi', 'hii', 'hello', 'hey'];

// Function to strip markdown for speech synthesis
function stripMarkdown(text) {
  return text
    .replace(/^###\s*(.+)$/gm, '$1') // Remove ### headings
    .replace(/^##\s*(.+)$/gm, '$1')  // Remove ## headings
    .replace(/^#\s*(.+)$/gm, '$1')   // Remove # headings
    .replace(/\*\*(.*?)\*\*/g, "$1") // Remove **bold**
    .replace(/\*(.*?)\*/g, "$1")     // Remove *italic*
    .replace(/^-+\s*(.*)$/gm, "$1")  // Remove - bullets
    .replace(/^\d+\.\s*(.*)$/gm, "$1") // Remove numbered lists (e.g., 1. item)
    .replace(/(\r\n|\n|\r)/gm, " "); // Replace newlines with spaces
}

async function synthesizeSpeech(text, language) {
  console.log('synthesizeSpeech: Requesting audio:', { text, language });
  try {
    const lang = supportedLanguages.includes(language) ? language : 'en';
    console.log('synthesizeSpeech: Using language for synthesis:', lang);
    const response = await fetch(`${BACKEND_URL}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: lang })
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Backend error: ${errorData.error || response.statusText}`);
    }
    const data = await response.json();
    console.log('synthesizeSpeech: Received audioUrl:', data.audioUrl);
    return data.audioUrl || null;
  } catch (error) {
    console.error('synthesizeSpeech: Error:', error.message);
    return null;
  }
}

async function transcribeAudio(audioBlob) {
  console.log('transcribeAudio: Sending audio to backend, blob size:', audioBlob.size);
  try {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    const response = await fetch(`${BACKEND_URL}/transcribe`, {
      method: 'POST',
      body: formData
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Backend error: ${errorData.error || response.statusText}`);
    }
    const data = await response.json();
    console.log('transcribeAudio: Received transcription:', data.text);
    return data.text || '';
  } catch (error) {
    console.error('transcribeAudio: Error:', error.message);
    throw error;
  }
}

export async function sendMessage(message, isFileUpload = false) {
  console.log("sendMessage: Input message:", message);
  console.log("sendMessage: Is file upload?", isFileUpload);

  // Detect language
  let detectedLang;
  try {
    detectedLang = await detectLanguage(message);
    console.log("sendMessage: Detected language:", detectedLang);

    // Force English for common greetings or short English-like inputs
    const trimmedMessage = message.trim().toLowerCase();
    if (englishGreetings.includes(trimmedMessage) || (message.length <= 5 && detectedLang !== "en")) {
      console.log("sendMessage: Forcing language to English due to greeting or short input");
      detectedLang = "en";
    }
  } catch (error) {
    console.error("sendMessage: Language detection error:", error.message);
    detectedLang = "en";
  }
  
  // Update userLanguage for non-file-upload messages
  if (!isFileUpload) {
    userLanguage = detectedLang;
  }
  console.log("sendMessage: Current userLanguage:", userLanguage);

  // Translate to English for OpenAI
  let englishMessage = message;
  if (detectedLang !== "en") {
    console.log(`sendMessage: Translating input from ${detectedLang} to en`);
    try {
      englishMessage = await translateText(message, detectedLang, "en");
    } catch (error) {
      console.error("sendMessage: Translation error:", error.message);
    }
  }
  console.log("sendMessage: English message for OpenAI:", englishMessage);

  // Call Azure OpenAI with explicit language instruction
  let reply;
  try {
    const response = await fetch(`${AZURE_OPENAI_ENDPOINT}/openai/deployments/${DEPLOYMENT_NAME}/chat/completions?api-version=${API_VERSION}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": AZURE_OPENAI_KEY
      },
      body: JSON.stringify({
        messages: [
          { 
            role: "system", 
            content: `You are an assistant named Sahayak that helps people in filling government-related forms or telling them about government schemes and policies presently available. Respond in the same language as the user's input, which is ${userLanguage} (e.g., 'en' for English, 'hi' for Hindi).` 
          },
          { role: "user", content: englishMessage }
        ],
        temperature: 0.7
      })
    });
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }
    const data = await response.json();
    reply = data.choices?.[0]?.message?.content || "(No reply)";
    console.log("sendMessage: OpenAI raw reply:", reply);
  } catch (error) {
    console.error("sendMessage: OpenAI error:", error.message);
    reply = "Error fetching response from OpenAI.";
  }

  // Translate reply to userLanguage (only if OpenAI didn't follow the language instruction)
  if (userLanguage !== "en") {
    console.log(`sendMessage: Translating reply from en to ${userLanguage}`);
    try {
      reply = await translateText(reply, "en", userLanguage);
    } catch (error) {
      console.error("sendMessage: Translation error:", error.message);
    }
  } else {
    console.log("sendMessage: No translation needed, userLanguage is English");
  }
  console.log("sendMessage: Final translated reply:", reply);

  // Strip markdown for speech synthesis
  const speechText = stripMarkdown(reply);
  console.log("sendMessage: Text for speech synthesis (markdown stripped):", speechText);

  // Generate audio
  const audioUrl = await synthesizeSpeech(speechText, userLanguage);
  console.log("sendMessage: Audio URL:", audioUrl);

  return { text: reply, audioUrl };
}

export async function sendVoiceMessage(audioBlob) {
  console.log("sendVoiceMessage: Processing audio blob, size:", audioBlob.size);
  try {
    const transcribedText = await transcribeAudio(audioBlob);
    if (!transcribedText) {
      throw new Error("No transcription available");
    }
    console.log("sendVoiceMessage: Transcribed text:", transcribedText);
    return await sendMessage(transcribedText);
  } catch (error) {
    console.error("sendVoiceMessage: Error:", error.message);
    throw error;
  }
}

export async function handleFileUpload(file) {
  console.log("handleFileUpload: File type:", file.type);
  let content = "";
  const fileType = file.type;

  if (fileType === "application/pdf") {
    content = await analyzeDocument(file);
  } else if (fileType.startsWith("image/")) {
    content = await analyzeImage(file);
  } else {
    console.log(`handleFileUpload: Translating error message to ${userLanguage}`);
    const errorText = await translateText("Unsupported file type. Please upload an image or PDF.", "en", userLanguage);
    const audioUrl = await synthesizeSpeech(errorText, userLanguage);
    return { text: errorText, audioUrl };
  }

  console.log("handleFileUpload: Extracted content:", content);
  const prompt = `The following is the content or description of a document or image: "${content}". As Sahayak, identify the type of form or document, describe the clear placeholders (fields to fill), explain how to fill them, and highlight the most important benefits (not all benefits, just the key ones).`;
  console.log("handleFileUpload: Sending prompt:", prompt);

  const reply = await sendMessage(prompt, true);
  console.log("handleFileUpload: OpenAI reply:", reply.text);

  return reply;
}

async function analyzeImage(file) {
  console.log("analyzeImage: Processing image:", file.name, "Size:", file.size, "Type:", file.type);
  try {
    if (!file.type.startsWith("image/")) {
      throw new Error("Invalid file type. Please upload an image.");
    }
    if (file.size > 20 * 1024 * 1024) {
      throw new Error("Image size exceeds 20MB limit.");
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64Image = btoa(
      new Uint8Array(arrayBuffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ''
      )
    );
    const imageDataUrl = `data:${file.type};base64,${base64Image}`;

    console.log("analyzeImage: Sending image to OpenAI");
    const response = await fetch(`${AZURE_OPENAI_ENDPOINT}/openai/deployments/${DEPLOYMENT_NAME}/chat/completions?api-version=${API_VERSION}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": AZURE_OPENAI_KEY
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: "You are an assistant that extracts text from images and describes their content. Extract any visible text or describe the content if no text is present."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract any text from this image or describe its content if no text is present."
              },
              {
                type: "image_url",
                image_url: { url: imageDataUrl }
              }
            ]
          }
        ],
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("analyzeImage: OpenAI API error:", response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "No text or content could be extracted from the image.";
    console.log("analyzeImage: Extracted text or description:", text);
    return text;
  } catch (error) {
    console.error("analyzeImage: Error:", error.message);
    const errorText = await translateText(`Error processing image: ${error.message}. Please ensure the image is valid and try again.`, "en", userLanguage);
    const audioUrl = await synthesizeSpeech(errorText, userLanguage);
    return { text: errorText, audioUrl };
  }
}