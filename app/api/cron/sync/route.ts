import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { runSync } from "@/lib/sync";

/**
 * GET /api/cron/sync
 *
 * Daily synchronisation triggered by Vercel Cron. The request must carry
 * `Authorization: Bearer $CRON_SECRET`; anything else is refused so nobody can use
 * the deployment as a free proxy to the source API.
 */
export const maxDuration = 60;

/** Constant time comparison, so the secret cannot be guessed by timing. */
function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    return false;
  }
  const provided = Buffer.from(match[1].trim());
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}

export async function GET(request: Request): Promise<Response> {
  if (!isCronAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const result = await runSync(db, { trigger: "cron", triggeredBy: "vercel-cron" });

  return Response.json(
    {
      status: result.status,
      run_id: result.runId,
      requests: result.requests,
      records: result.records,
      message: result.message,
    },
    { status: result.status === "success" ? 200 : 500, headers: { "Cache-Control": "no-store" } },
  );
}
