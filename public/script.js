import { sendMessage, handleFileUpload, sendVoiceMessage } from "./chat.js";

// Wait for DOM to load
document.addEventListener("DOMContentLoaded", () => {
  const chat = document.getElementById("chat");
  const userInput = document.getElementById("user-input");
  const fileInput = document.getElementById("file-upload");
  const voiceButton = document.getElementById("voice-button");
  const sendButton = document.getElementById("send-button");

  if (!chat || !userInput || !fileInput || !voiceButton || !sendButton) {
    console.error("DOM elements missing:", {
      chat: !!chat,
      userInput: !!userInput,
      fileInput: !!fileInput,
      voiceButton: !!voiceButton,
      sendButton: !!sendButton
    });
    return;
  }

  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;

  function appendMessage(content, sender = "bot", audioUrl = null) {
    console.log('appendMessage:', { content, sender, audioUrl });
    const msg = document.createElement("div");
    msg.className = `message ${sender}`;
    msg.innerHTML = content;
    
    if (sender === "bot" && audioUrl) {
      const audio = document.createElement("audio");
      audio.className = "audio-player";
      audio.controls = true;
      audio.autoplay = true;
      audio.src = audioUrl;
      audio.onerror = () => console.error('Audio error: Failed to load', audioUrl);
      msg.appendChild(audio);
    }
    
    chat.appendChild(msg);
    chat.scrollTop = chat.scrollHeight;
  }

  function formatMarkdown(text) {
    return text
      .replace(/^###\s*(.+)$/gm, '<span class="header">$1</span>')
      .replace(/^##\s*(.+)$/gm, '<span class="header">$1</span>')
      .replace(/^#\s*(.+)$/gm, '<span class="header">$1</span>')
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");
  }

  // Handle sending message (for both button click and Enter key)
  async function handleSendMessage() {
    const message = userInput.value.trim();
    if (!message) return;
    userInput.value = "";
    appendMessage(formatMarkdown(message), "user");
    try {
      const { text, audioUrl } = await sendMessage(message);
      console.log('sendMessage response:', { text, audioUrl });
      appendMessage(formatMarkdown(text), "bot", audioUrl);
    } catch (error) {
      console.error('sendMessage error:', error.message);
      appendMessage('Error: Could not fetch response.', "bot");
    }
  }

  // Send button click
  sendButton.addEventListener("click", handleSendMessage);

  // Enter key press
  userInput.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault(); // Prevent form submission or newline
      handleSendMessage();
    }
  });

  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    appendMessage(`Uploaded file: ${file.name}`, "user");
    try {
      const { text, audioUrl } = await handleFileUpload(file);
      console.log('handleFileUpload response:', { text, audioUrl });
      appendMessage(formatMarkdown(text), "bot", audioUrl);
    } catch (error) {
      console.error('handleFileUpload error:', error.message);
      appendMessage('Error: Could not process file.', "bot");
    }
  });

  // Voice recording with click-to-toggle
  voiceButton.addEventListener("click", (event) => {
    event.preventDefault();
    console.log("voiceButton clicked, isRecording:", isRecording);
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  });

  async function startRecording() {
    console.log("startRecording: Initiating...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("startRecording: Microphone access granted");
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        console.log("startRecording: Data available", e.data.size, "bytes");
        audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        console.log("startRecording: Recording stopped");
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());
        appendMessage('Voice message recorded', "user");
        try {
          const { text, audioUrl } = await sendVoiceMessage(audioBlob);
          console.log('sendVoiceMessage response:', { text, audioUrl });
          appendMessage(formatMarkdown(text), "bot", audioUrl);
        } catch (error) {
          console.error('sendVoiceMessage error:', error.message);
          appendMessage('Error: Could not process voice message.', "bot");
        }
      };

      mediaRecorder.start();
      isRecording = true;
      voiceButton.classList.add("recording");
      voiceButton.querySelector("i").classList.remove("fa-microphone");
      voiceButton.querySelector("i").classList.add("fa-stop");
      console.log("startRecording: Recording started");
    } catch (error) {
      console.error("startRecording: Error:", error.message);
      let errorMessage = 'Error: Could not access microphone. Please check permissions and ensure microphone is enabled in your browser settings.';
      if (error.message.includes('MediaRecorder')) {
        errorMessage = 'Error: Audio recording format not supported by browser.';
      }
      appendMessage(errorMessage, "bot");
    }
  }

  function stopRecording() {
    console.log("stopRecording: Attempting to stop...");
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      isRecording = false;
      voiceButton.classList.remove("recording");
      voiceButton.querySelector("i").classList.remove("fa-stop");
      voiceButton.querySelector("i").classList.add("fa-microphone");
      console.log("stopRecording: Stopped");
    } else {
      console.log("stopRecording: No active recording to stop");
    }
  }
});
