import { createServer } from "node:http";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { createApi } from "./runtime.js";
import { JSON_LIMIT, REQUEST_TIMEOUT_MS } from "./config.js";

const api = createApi();
const host = process.env.API_HOST || "127.0.0.1";
const port = Number(process.env.API_PORT || "7071");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT must be a valid port.");
const server = createServer(async (incoming, outgoing) => {
  const controller = new AbortController();
  incoming.on("aborted", () => controller.abort());
  outgoing.on("close", () => { if (!outgoing.writableEnded) controller.abort(); });
  try {
    if (Number(incoming.headers["content-length"]) > JSON_LIMIT) {
      outgoing.writeHead(413, { "Content-Type": "application/json", "Connection": "close" });
      outgoing.end(JSON.stringify({ error: { code: "BODY_TOO_LARGE", message: "JSON body exceeds 9 MiB.", requestId: randomUUID() } }));
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
      else if (value !== undefined) headers.set(key, value);
    }
    const init: RequestInit & { duplex: "half" } = {
      method: incoming.method, headers, signal: controller.signal, duplex: "half"
    };
    if (incoming.method !== "GET" && incoming.method !== "HEAD") init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
    const request = new Request(new URL(incoming.url || "/", `http://127.0.0.1:${port}`), init);
    const response = await api.handle(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500, { "Content-Type": "application/json" });
    outgoing.end(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Unable to process request.", requestId: randomUUID() } }));
  }
});
server.requestTimeout = REQUEST_TIMEOUT_MS + 10_000;
server.headersTimeout = 15_000;
server.timeout = REQUEST_TIMEOUT_MS + 15_000;
server.listen(port, host, () => {
  console.log(`Sahayak API listening at http://${host}:${port}/api`);
  if (host !== "127.0.0.1" && host !== "::1") console.warn("Non-loopback listener: demo has no real authentication. Use fictional data on a trusted private network only; never expose demo publicly.");
});
