import { app } from "@azure/functions";
import { createApi } from "./runtime.js";

const api = createApi();
app.http("sahayak", {
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  route: "{*path}",
  handler: async request => {
    // "anonymous" is a Functions key setting, not application authorization.
    // Api verifies signed Entra JWTs on every Azure route except health.
    const init: RequestInit & { duplex: "half" } = {
      method: request.method, headers: Object.fromEntries(request.headers.entries()), duplex: "half"
    };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body as BodyInit | null;
    const response = await api.handle(new Request(request.url, init));
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body: await response.text() };
  }
});
