import { createHash, randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Config } from "./config.js";
import { ApiError } from "./errors.js";

export function authenticator(config: Config) {
  const tenant = config.values.ENTRA_TENANT_ID;
  const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
  const keys = config.mode === "azure" ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`), { timeoutDuration: 5000 }) : undefined;
  return async (headers: Headers, responseHeaders: Headers): Promise<string> => {
    if (config.mode === "demo") {
      const cookie = headers.get("cookie")?.match(/(?:^|;\s*)sahayak_demo=([0-9a-f-]{36})(?:;|$)/i)?.[1];
      const supplied = headers.get("x-sahayak-demo-owner") || cookie;
      if (supplied && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(supplied))
        throw new ApiError(400, "INVALID_DEMO_OWNER", "x-sahayak-demo-owner must be a UUID.");
      const owner = supplied || randomUUID();
      if (!supplied) responseHeaders.set("set-cookie", `sahayak_demo=${owner}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=86400`);
      return hash(`demo:${owner}`);
    }
    const bearer = /^Bearer ([^\s]+)$/i.exec(headers.get("authorization") || "");
    if (!bearer) throw new ApiError(401, "UNAUTHORIZED", "A Microsoft Entra delegated access token is required.");
    try {
      const { payload } = await jwtVerify(bearer[1], keys!, {
        issuer, audience: config.values.ENTRA_API_AUDIENCE, algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "sub"], clockTolerance: 5
      });
      if (payload.tid !== tenant || typeof payload.scp !== "string" || !payload.scp.split(" ").includes(config.values.ENTRA_REQUIRED_SCOPE))
        throw new ApiError(403, "FORBIDDEN", "Token does not have the required delegated scope.");
      const id = typeof payload.oid === "string" ? payload.oid : payload.sub;
      if (!id) throw new Error("Missing subject");
      return hash(`${tenant}:${id}`);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, "UNAUTHORIZED", "The access token is invalid or expired.");
    }
  };
}
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
