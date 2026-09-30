/* Portal del cliente: qué puede ver el dueño de la carga.
 *
 * Es la única superficie del sistema que mira alguien de fuera de la
 * operación, y eso dicta el diseño: un cliente ve **sus** envíos y nada
 * más. La pertenencia no se pide por parámetro (sería suplantable), se
 * deriva de la empresa del usuario autenticado y se aplica en el WHERE
 * de la consulta. Una referencia de otra empresa responde 404, no 403:
 * un 403 confirmaría que esa referencia existe.
 *
 * La cadena del dato es la que ya modela la base: el usuario pertenece
 * a una empresa, la empresa tiene envíos, un envío viaja en un trayecto
 * y el trayecto va en una unidad — que es la que trae nodos publicando
 * telemetría. Aquí solo se recorre; no se inventa modelo nuevo.
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

import type { NotificationPort } from "../../../domain/ports/NotificationPort.js";
import { avisoDeConsulta } from "../../../domain/avisos.js";
import { requireRole } from "./authGuard.js";

/** Mismo formato que valida la landing antes de llamar (16-64, mayúsculas,
 *  dígitos y guiones). Se revalida aquí: el servidor de la landing es un
 *  cliente más y no se le delega la validación. */
const consultaSchema = z.object({
  reference: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{15,63}$/, "Referencia con formato inválido."),
});

/** Sin telemetría en esta ventana, el envío se reporta como "waiting":
 *  la unidad existe pero no está publicando ahora mismo. */
const VENTANA_REPORTANDO_MS = 10 * 60 * 1000;

interface FilaEnvio {
  reference: string;
  description: string | null;
  origin: string | null;
  destination: string | null;
  unit_id: string | null;
  last_ts: Date | null;
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
}

export function registerCustomerRoutes(
  app: FastifyInstance,
  pool: Pool,
  notificador: NotificationPort,
): void {
  /** Quién soy y a qué empresa pertenezco. La landing la usa para
   *  confirmar que el token sigue siendo de un cliente antes de
   *  mostrarle el portal. */
  app.get(
    "/customer/session",
    { preHandler: requireRole("cliente") },
    async (request, reply) => {
      const actor = request.actor!;
      const { rows } = await pool.query<{ company_name: string | null }>(
        `SELECT c.name AS company_name
           FROM users u
           LEFT JOIN companies c ON c.id = u.company_id
          WHERE u.id = $1 AND u.active`,
        [actor.id],
      );

      if (rows.length === 0) {
        return reply
          .code(403)
          .send({ error: "sin cuenta", message: "La cuenta no está habilitada." });
      }

      return reply.send({
        role: "cliente",
        email: actor.email,
        companyName: rows[0]!.company_name ?? "",
      });
    },
  );

  /** Estado de un envío propio. */
  app.post(
    "/customer/tracking",
    { preHandler: requireRole("cliente") },
    async (request, reply) => {
      const parsed = consultaSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "referencia inválida",
          message: parsed.error.issues[0]?.message ?? "Revisa la referencia.",
        });
      }

      const actor = request.actor!;
      const referencia = parsed.data.reference;

      // El filtro por empresa va en la consulta, no en código posterior:
      // así no hay forma de olvidarlo en una rama.
      //
      // La unidad sale del trayecto activo que lleva este envío. Un
      // envío puede haber viajado en varios trayectos (tramo marítimo,
      // tramo ferroviario): interesa el más reciente que siga activo.
      const { rows } = await pool.query<FilaEnvio>(
        `WITH envio AS (
           SELECT s.code AS reference, s.description,
                  o.name AS origin, d.name AS destination,
                  (SELECT t.unit_id
                     FROM trip_shipments ts
                     JOIN trips t ON t.id = ts.trip_id
                    WHERE ts.shipment_id = s.id AND ts.active AND t.active
                    ORDER BY t.actual_departure DESC NULLS LAST,
                             t.planned_departure DESC
                    LIMIT 1) AS unit_id
             FROM shipments s
             JOIN users u ON u.company_id = s.company_id
             LEFT JOIN locations o ON o.id = s.origin_id
             LEFT JOIN locations d ON d.id = s.destination_id
            WHERE s.code = $1 AND s.active AND u.id = $2
         )
         SELECT e.*, t.ts AS last_ts, t.gps_lat AS lat, t.gps_lon AS lon,
                t.gps_accuracy_m AS accuracy_m
           FROM envio e
           LEFT JOIN LATERAL (
             SELECT tel.ts, tel.gps_lat, tel.gps_lon, tel.gps_accuracy_m
               FROM telemetry tel
               JOIN nodes n ON n.id = tel.node_id
              WHERE n.unit_id = e.unit_id AND tel.gps_lat IS NOT NULL
              ORDER BY tel.ts DESC
              LIMIT 1
           ) t ON true`,
        [referencia, actor.id],
      );

      // 404 también cuando la referencia existe pero es de otra empresa:
      // distinguir los dos casos revelaría qué referencias hay.
      if (rows.length === 0) {
        return reply.code(404).send({
          error: "no encontrado",
          message: "No encontramos esa referencia.",
        });
      }

      const fila = rows[0]!;
      const ahora = new Date();
      const reportando =
        fila.last_ts !== null &&
        ahora.getTime() - fila.last_ts.getTime() < VENTANA_REPORTANDO_MS;

      const respuesta = {
        reference: fila.reference,
        origin: fila.origin,
        destination: fila.destination,
        description: fila.description,
        checkedAt: ahora.toISOString(),
        lastReportAt: fila.last_ts?.toISOString() ?? null,
        status: reportando ? ("reporting" as const) : ("waiting" as const),
        eventsAvailable: false,
        location:
          fila.lat !== null && fila.lon !== null && fila.last_ts !== null
            ? {
                lat: fila.lat,
                lon: fila.lon,
                accuracy: fila.accuracy_m,
                at: fila.last_ts.toISOString(),
              }
            : null,
        events: [],
      };

      // El aviso sale después de tener la respuesta lista y no se
      // espera: si el correo tarda o falla, la consulta ya se contestó.
      const aviso = avisoDeConsulta({
        email: actor.email,
        referencia: fila.reference,
        descripcion: fila.description,
        origen: fila.origin,
        destino: fila.destination,
        estado: respuesta.status,
        ultimoReporte: fila.last_ts,
        cuando: ahora,
      });
      void notificador
        .send({ to: actor.email, ...aviso })
        .then((r) => {
          if (!r.sent) app.log.warn({ err: r.error }, "aviso de consulta no enviado");
        })
        .catch((err) => app.log.warn({ err }, "aviso de consulta no enviado"));

      return reply.send(respuesta);
    },
  );
}
