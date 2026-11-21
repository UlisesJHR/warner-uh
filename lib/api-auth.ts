import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { apiTokens } from "./db/schema";
import { hashToken } from "./auth";

/**
 * Bearer token authentication for the public validation endpoints.
 *
 * Tokens are compared by hash, revoked tokens are rejected, and the last use is
 * recorded for the panel. The endpoints are read only, so a token can never change
 * data.
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
  // Personalised loyalty data must never be cached by a shared proxy.
  "Cache-Control": "no-store",
};

/** True when the request carries a live, unrevoked API token. */
export async function isAuthorizedApiRequest(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    return false;
  }
  const token = match[1].trim();
  if (token.length < 20) {
    return false;
  }

  const db = await getDb();
  const [row] = await db
    .select({ id: apiTokens.id })
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hashToken(token)), isNull(apiTokens.revokedAt)))
    .limit(1);

  if (!row) {
    return false;
  }

  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));
  return true;
}

/** JSON response with the required CORS headers. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

/** Preflight response required by the browser-based evaluation. */
export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Standard 401 body for a missing or invalid token. */
export function unauthorizedResponse(): Response {
  return jsonResponse({ error: "A valid Bearer token is required." }, 401);
}
