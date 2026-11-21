import { asc, sql } from "drizzle-orm";
import {
  isAuthorizedApiRequest,
  jsonResponse,
  preflightResponse,
  unauthorizedResponse,
} from "@/lib/api-auth";
import { CUTOFF_DATE } from "@/lib/constants";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { addDays, upcomingBirthday } from "@/lib/loyalty";

/**
 * GET /api/fidelizacion/cumpleanos
 *
 * Full list of customers whose birthday falls between the cutoff and seven days
 * later, both inclusive. The comparison uses the month and day of `dob` only.
 */
export async function GET(request: Request): Promise<Response> {
  if (!(await isAuthorizedApiRequest(request))) {
    return unauthorizedResponse();
  }

  // Filter in SQL by month/day first, then confirm with the shared rule function.
  const window: string[] = [];
  for (let offset = 0; offset <= 7; offset += 1) {
    window.push(addDays(CUTOFF_DATE, offset).slice(5));
  }

  const db = await getDb();
  const rows = await db
    .select({ id: customers.id, dob: customers.dob })
    .from(customers)
    .where(sql`substring(${customers.dob}, 6, 5) in (${sql.join(window.map((value) => sql`${value}`), sql`, `)})`)
    .orderBy(asc(customers.id));

  const payload = rows
    .map((row) => {
      const date = upcomingBirthday(row.dob);
      return date ? { cliente_id: row.id, fecha_cumpleanos: date } : null;
    })
    .filter((row): row is { cliente_id: number; fecha_cumpleanos: string } => row !== null);

  return jsonResponse(payload);
}

/** CORS preflight. */
export function OPTIONS(): Response {
  return preflightResponse();
}
