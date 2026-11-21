import { randomBytes } from "node:crypto";
import { getStaffSession, hasPermission, hashToken } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiTokens } from "@/lib/db/schema";

/**
 * Create an evaluation API token.
 *
 * The raw token is returned once in a no-store HTML page and only its SHA-256
 * hash is stored, exactly like the portal access flow. A token generated here is
 * what the automatic evaluation sends as `Authorization: Bearer <token>`.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getStaffSession();
  if (!session) {
    return htmlResponse("<p>Sign in to continue.</p>", 401);
  }
  if (!hasPermission(session, "tokens:manage")) {
    return htmlResponse("<p>Your role cannot manage API tokens.</p>", 403);
  }

  const formData = await request.formData();
  const label = String(formData.get("label") ?? "").trim() || "Evaluation token";

  const token = `loy_${randomBytes(24).toString("base64url")}`;
  const db = await getDb();
  await db.insert(apiTokens).values({
    label,
    tokenHash: hashToken(token),
    prefix: token.slice(0, 10),
    createdBy: session.staffUserId,
  });

  return htmlResponse(
    `<p class="ok">Token created for ${escapeHtml(label)}.</p>
     <p>Copy it now. It is shown once and only its hash is stored.</p>
     <pre>${escapeHtml(token)}</pre>
     <p class="hint">Send it as <code>Authorization: Bearer &lt;token&gt;</code> to the /api/fidelizacion endpoints.</p>
     <p><a href="/admin/tokens">Back to API tokens</a></p>`,
    201,
  );
}

/** Escape user controlled text before it enters the one time HTML page. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Minimal standalone HTML document with caching disabled. */
function htmlResponse(body: string, status: number): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>API token</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; padding: 2rem 1.25rem; background: light-dark(#f6f5f3, #14161c); color: light-dark(#1b1b1b, #f2f2f2); }
  main { max-width: 40rem; margin: 0 auto; background: light-dark(#fff, #1d2028); border: 1px solid light-dark(#e2e0dc, #333a48); border-radius: 12px; padding: 1.5rem; }
  pre { overflow-x: auto; padding: 0.75rem; border-radius: 8px; background: light-dark(#f0ede8, #262b36); font-size: 0.95rem; }
  code { font-size: 0.95rem; }
  .hint { color: light-dark(#5a5a5a, #b4b8c2); font-size: 0.9rem; }
  .ok { font-weight: 600; }
  a { color: light-dark(#a15c14, #f0b070); }
</style>
</head>
<body><main>${body}</main></body>
</html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
