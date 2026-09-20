import { MAX_DOCUMENT_CHARS, MAX_FILE_BYTES, type Upload, type FormField } from "@sahayak/shared";
import { ApiError } from "./errors.js";

const documentTypes = new Set(["text/plain", "application/pdf", "image/png", "image/jpeg"]);
const audioTypes = new Set(["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/webm", "audio/ogg"]);

export function decodeUpload(file: Upload, kind: "document" | "audio"): Buffer {
  if (!(kind === "document" ? documentTypes : audioTypes).has(file.mimeType))
    throw new ApiError(415, "UNSUPPORTED_MIME", `Unsupported ${kind} MIME type.`);
  if (file.base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(file.base64))
    throw new ApiError(400, "INVALID_BASE64", "Upload must contain canonical base64 bytes.");
  const bytes = Buffer.from(file.base64, "base64");
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", "Upload must be nonempty and no larger than 6 MiB.");
  if (bytes.toString("base64") !== file.base64) throw new ApiError(400, "INVALID_BASE64", "Upload contains invalid base64.");
  const hex = bytes.subarray(0, 12).toString("hex");
  const ascii = bytes.subarray(0, 12).toString("ascii");
  let valid = false;
  switch (file.mimeType) {
    case "text/plain": decodeText(bytes); valid = true; break;
    case "application/pdf": valid = ascii.startsWith("%PDF-"); break;
    case "image/png": valid = hex.startsWith("89504e470d0a1a0a"); break;
    case "image/jpeg": valid = hex.startsWith("ffd8ff"); break;
    case "audio/wav": case "audio/x-wav": valid = ascii.startsWith("RIFF") && ascii.slice(8) === "WAVE"; break;
    case "audio/mp4": case "audio/m4a": case "audio/x-m4a": valid = ascii.slice(4, 8) === "ftyp"; break;
    case "audio/webm": valid = hex.startsWith("1a45dfa3"); break;
    case "audio/ogg": valid = ascii.startsWith("OggS"); break;
    case "audio/aac": valid = bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0; break;
    case "audio/mpeg": valid = ascii.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0); break;
  }
  if (!valid) throw new ApiError(415, "SIGNATURE_MISMATCH", "File bytes do not match the declared MIME type.");
  return bytes;
}

export function boundText(text: string): string {
  if (text.length > MAX_DOCUMENT_CHARS) throw new ApiError(413, "DOCUMENT_TOO_LONG", `Document exceeds ${MAX_DOCUMENT_CHARS} characters; split it into smaller documents.`);
  return text;
}
export function decodeText(bytes: Buffer): string {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ApiError(415, "INVALID_UTF8", "Text uploads must be valid UTF-8."); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
    throw new ApiError(415, "INVALID_TEXT", "Binary control characters are not supported in text uploads.");
  return boundText(text);
}

export function colonFields(text: string): FormField[] {
  const fields: FormField[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^([^:\r\n]{1,100}):[ \t]*(.*)$/.exec(line);
    if (!match) continue;
    if (match[2].length > 2000) throw new ApiError(413, "FIELD_TOO_LONG", "A form answer exceeds 2000 characters.");
    fields.push({ id: `field-${fields.length + 1}`, label: match[1].trim(), value: match[2].trim(), confirmed: false, source: "Uploaded text; review required" });
    if (fields.length > 80) throw new ApiError(413, "TOO_MANY_FIELDS", "At most 80 form fields are supported; split the document.");
  }
  return fields;
}

// Exact concatenation preserves whitespace and surrogate pairs, including in long sentences.
export function chunks(text: string, max = 4000): string[] {
  if (max < 2) throw new Error("Chunk size must be >=2.");
  const result: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + max, text.length);
    if (end < text.length) {
      const section = text.slice(start, end);
      const boundaries = [...section.matchAll(/[.!?。！？]\s+|\n+/gu)];
      const last = boundaries.at(-1);
      if (last && last.index! > max / 2) end = start + last.index! + last[0].length;
      else if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    result.push(text.slice(start, end));
    start = end;
  }
  return result;
}
