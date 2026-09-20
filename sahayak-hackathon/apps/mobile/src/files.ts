import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { MAX_FILE_BYTES, type ExportResponse, type Upload } from "@sahayak/shared";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0, b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    result += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)]
      + (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=")
      + (i + 2 < bytes.length ? alphabet[c & 63] : "=");
  }
  return result;
}
export async function readUpload(uri: string, name: string, mimeType: string, knownSize?: number): Promise<Upload> {
  if (knownSize !== undefined && knownSize > MAX_FILE_BYTES) throw new Error("Files must be 6 MB or smaller.");
  let base64: string;
  if (Platform.OS === "web") {
    const response = await fetch(uri);
    const blob = await response.blob();
    if (blob.size > MAX_FILE_BYTES) throw new Error("Files must be 6 MB or smaller.");
    base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result.split(",")[1] || "") : reject(new Error("Could not read this file."));
      reader.onerror = () => reject(new Error("Could not read this file."));
      reader.readAsDataURL(blob);
    });
  } else {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) throw new Error("The selected file is no longer available.");
    if (info.size > MAX_FILE_BYTES) throw new Error("Files must be 6 MB or smaller.");
    base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  }
  if (!base64 || base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) throw new Error("Choose a nonempty file no larger than 6 MB.");
  return { name, mimeType, base64 };
}
export async function clearCache(uri: string): Promise<void> {
  if (Platform.OS === "web") {
    if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
  } else if (FileSystem.cacheDirectory && uri.startsWith(FileSystem.cacheDirectory)) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}
export async function audioUri(base64: string): Promise<string> {
  if (Platform.OS === "web") return `data:audio/mpeg;base64,${base64}`;
  if (!FileSystem.cacheDirectory) throw new Error("Audio cache is unavailable.");
  const uri = `${FileSystem.cacheDirectory}sahayak-voice-${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}
export async function exportAnswers(file: ExportResponse): Promise<void> {
  if (Platform.OS === "web") {
    const bytes = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "reviewed-answer.txt";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  if (!FileSystem.cacheDirectory) throw new Error("Export cache is unavailable.");
  const uri = `${FileSystem.cacheDirectory}reviewed-answer.txt`;
  try {
    await FileSystem.writeAsStringAsync(uri, file.base64, { encoding: FileSystem.EncodingType.Base64 });
    if (!await Sharing.isAvailableAsync()) throw new Error("Sharing is not available on this device.");
    await Sharing.shareAsync(uri, { mimeType: "text/plain", dialogTitle: "Save reviewed answers", UTI: "public.plain-text" });
  } finally {
    await clearCache(uri);
  }
}
