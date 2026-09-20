export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function unsupported(message: string): never { throw new ApiError(501, "DEMO_UNSUPPORTED", message); }
export function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new ApiError(504, "REQUEST_TIMEOUT", "The operation timed out. Please try again.");
}
export function notFound(): never { throw new ApiError(404, "NOT_FOUND", "Document not found or expired."); }
