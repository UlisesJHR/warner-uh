import { eq } from "drizzle-orm";
import {
  isAuthorizedApiRequest,
  jsonResponse,
  preflightResponse,
  unauthorizedResponse,
} from "@/lib/api-auth";
import { getDb } from "@/lib/db";
import { customers, customerMetrics } from "@/lib/db/schema";

/**
 * GET /api/fidelizacion/riesgo
 *
 * Full, unpaginated list of customers at risk at the cutoff date, most inactive
 * first. At risk means at least one successful payment and 90 or more days without
 * activity.
 */
export async function GET(request: Request): Promise<Response> {
  if (!(await isAuthorizedApiRequest(request))) {
    return unauthorizedResponse();
  }

  const db = await getDb();
  const rows = await db
    .select({
      clienteId: customers.id,
      diasSinActividad: customerMetrics.daysInactive,
    })
    .from(customerMetrics)
    .innerJoin(customers, eq(customers.id, customerMetrics.customerId))
    .where(eq(customerMetrics.atRisk, true))
    .orderBy(customerMetrics.daysInactive);

  return jsonResponse(
    rows
      .map((row) => ({
        cliente_id: row.clienteId,
        dias_sin_actividad: row.diasSinActividad,
      }))
      .sort((a, b) => (b.dias_sin_actividad ?? 0) - (a.dias_sin_actividad ?? 0)),
  );
}

/** CORS preflight. */
export function OPTIONS(): Response {
  return preflightResponse();
}
