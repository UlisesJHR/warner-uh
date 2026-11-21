import {
  isAuthorizedApiRequest,
  jsonResponse,
  preflightResponse,
  unauthorizedResponse,
} from "@/lib/api-auth";
import { getDb } from "@/lib/db";
import { getCustomerDetail } from "@/lib/queries";
import { getEarnedPoints } from "@/lib/redeem";

/**
 * GET /api/fidelizacion/clientes/{id}
 *
 * Returns the loyalty snapshot for one customer using the exact field names from
 * the specification. `puntos` is the points earned from source activity, while
 * `puntos_disponibles` subtracts redemptions.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!(await isAuthorizedApiRequest(request))) {
    return unauthorizedResponse();
  }

  const { id } = await context.params;
  const customerId = Number(id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return jsonResponse({ error: "The customer id must be a positive integer." }, 400);
  }

  const detail = await getCustomerDetail(customerId);
  if (!detail) {
    return jsonResponse({ error: "Customer not found." }, 404);
  }

  const db = await getDb();
  const points = await getEarnedPoints(db, customerId);

  return jsonResponse({
    cliente_id: detail.customer.id,
    puntos: points,
    puntos_disponibles: detail.metrics.pointsAvailable,
    nivel: detail.metrics.level,
    gasto_12m: detail.metrics.spendCents / 100,
    en_riesgo: detail.metrics.atRisk,
    dias_sin_actividad: detail.metrics.daysInactive,
    movimientos: detail.movements.map((movement) => ({
      fecha: movement.date,
      tipo: movement.type,
      referencia: movement.reference,
      puntos: movement.points,
    })),
  });
}

/** CORS preflight for the browser based evaluation. */
export function OPTIONS(): Response {
  return preflightResponse();
}
