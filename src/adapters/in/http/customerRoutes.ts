import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { ManagementError, type Actor } from "./management/access.js";
import type { NotificationPort } from "../../../domain/ports/NotificationPort.js";
import { avisoDeConsulta } from "../../../domain/avisos.js";

// Sólo avisos aptos para clientes: nunca se envían eventos operativos crudos.
const notices: Record<string, readonly [string, string]> = {
  impact: ["Movimiento registrado", "Se registró un impacto. Este dato no confirma daños en la mercancía."],
  hard_brake: ["Actualización de recorrido", "Se registró una variación de movimiento durante el trayecto."],
  curve_overspeed: ["Actualización de recorrido", "Se registró una variación de movimiento durante el trayecto."],
  dynamic_impact: ["Movimiento registrado", "Se registró una variación de fuerza. Este dato no confirma daños en la mercancía."],
  track_irregularity: ["Actualización de recorrido", "Se registró una variación de vibración durante el trayecto."],
  rollover: ["Evento para revisión operativa", "La unidad registró una alerta que requiere verificación. Consulta con tu remitente."],
  door_open: ["Apertura registrada", "Se registró una apertura. Confirma con tu remitente si corresponde a una maniobra programada."],
  door_closed: ["Cierre registrado", "Se registró un cierre en la unidad de transporte."],
  threshold_exceeded: ["Evento para revisión operativa", "Se registró una lectura fuera del umbral configurado. No confirma daños."],
  signal_lost: ["Actualizaciones interrumpidas", "El dispositivo dejó de reportar. Su última posición puede haber cambiado."],
  signal_recovered: ["Actualizaciones restablecidas", "El dispositivo volvió a reportar al sistema."],
};
const bodySchema = z.object({ reference: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{15,63}$/) }).strict();

async function company(pool: Pool, actor: Actor) {
  if (actor.role !== "cliente" || !actor.company_id)
    throw new ManagementError(403, "Se requiere una cuenta de cliente con empresa asignada.");
  const { rows } = await pool.query("SELECT name FROM companies WHERE id=$1 AND active", [actor.company_id]);
  if (!rows.length) throw new ManagementError(403, "Tu empresa no está habilitada para consultar envíos.");
  return rows[0].name as string;
}

export function registerCustomerRoutes(app: FastifyInstance, pool: Pool, notificador: NotificationPort) {
  app.get("/customer/session", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return { role: "cliente", companyName: await company(pool, req.actor) };
  });
  app.post("/customer/tracking", { bodyLimit: 2048 }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    await company(pool, req.actor);
    const { reference } = bodySchema.parse(req.body);
    // La misma consulta decide propiedad y existencia; una guía ajena es 404.
    const { rows } = await pool.query(
      `SELECT s.code,s.name,s.description,o.name origin,d.name destination,
              journey.unit_id,journey.status trip_status,journey.actual_departure,
              CASE WHEN journey.status='cancelled' THEN journey.updated_at ELSE journey.actual_arrival END end_at
       FROM shipments s JOIN companies c ON c.id=s.company_id AND c.active
       LEFT JOIN locations o ON o.id=s.origin_id LEFT JOIN locations d ON d.id=s.destination_id
       LEFT JOIN LATERAL (
         SELECT t.* FROM trip_shipments ts JOIN trips t ON t.id=ts.trip_id
         WHERE ts.shipment_id=s.id AND ts.active AND t.active AND t.actual_departure<=now()
           AND t.status IN ('in_transit','completed','cancelled')
         ORDER BY t.actual_departure DESC,t.id DESC LIMIT 1
       ) journey ON true
       WHERE s.code=$1 AND s.company_id=$2 AND s.active`,
      [reference, req.actor.company_id],
    );
    const shipment = rows[0];
    if (!shipment) throw new ManagementError(404, "No encontramos esa referencia. Comprueba el número con tu remitente.");
    const now = new Date();
    const from = shipment.actual_departure;
    // Un viaje finalizado sin hora real de cierre no habilita lecturas posteriores.
    const until = shipment.end_at ?? (shipment.trip_status === "in_transit" ? now : from);
    let latest: { ts: Date } | undefined;
    let gps: { ts: Date; gpsLat: number; gpsLon: number; gpsAccuracyM: number | null } | undefined;
    let events: { id: string; title: string; detail: string; at: string }[] = [];
    let eventsAvailable = true;
    if (from && until) {
      const values = [shipment.unit_id, from, until];
      const window = `FROM telemetry t JOIN nodes n ON n.id=t.node_id
        WHERE n.unit_id=$1 AND t.ts >= $2 AND t.ts <= $3 AND t.ts<=now()`;
      const [last, position] = await Promise.all([
        pool.query(`SELECT t.ts ${window} ORDER BY t.ts DESC,t.received_at DESC LIMIT 1`, values),
        pool.query(`SELECT t.ts,t.gps_lat AS "gpsLat",t.gps_lon AS "gpsLon",t.gps_accuracy_m AS "gpsAccuracyM"
          ${window} AND t.gps_lat BETWEEN -90 AND 90 AND t.gps_lon BETWEEN -180 AND 180
          ORDER BY t.ts DESC,t.received_at DESC LIMIT 1`, values),
      ]);
      latest = last.rows[0]; gps = position.rows[0];
      try {
        const result = await pool.query(
          `SELECT kind,ts FROM events WHERE unit_id=$1 AND ts>=$2 AND ts<=$3 AND ts<=now()
           AND kind::text=ANY($4::text[]) ORDER BY ts DESC,id DESC LIMIT 20`, [...values, Object.keys(notices)],
        );
        events = result.rows.map((e, index) => ({ id: String(index), title: notices[e.kind]![0], detail: notices[e.kind]![1], at: e.ts.toISOString() }));
      } catch { eventsAvailable = false; }
    }
    const respuesta = {
      reference: shipment.code, origin: shipment.origin ?? null, destination: shipment.destination ?? null,
      description: shipment.description || shipment.name, checkedAt: now.toISOString(),
      lastReportAt: latest?.ts.toISOString() ?? null,
      location: gps ? { lat: gps.gpsLat, lon: gps.gpsLon, accuracy: gps.gpsAccuracyM != null && Number.isFinite(gps.gpsAccuracyM) && gps.gpsAccuracyM>=0 ? gps.gpsAccuracyM : null, at: gps.ts.toISOString() } : null,
      eta: null, status: shipment.trip_status === "in_transit" && latest && now.getTime()-latest.ts.getTime()<=120000 ? "reporting" : "waiting",
      eventsAvailable, events,
    };

    // El aviso sale con la respuesta ya armada y no se espera: si el
    // correo tarda o falla, la consulta ya se contesto.
    const aviso = avisoDeConsulta({
      email: req.actor.email,
      referencia: respuesta.reference,
      descripcion: respuesta.description ?? null,
      origen: respuesta.origin,
      destino: respuesta.destination,
      estado: respuesta.status as "reporting" | "waiting",
      ultimoReporte: latest?.ts ?? null,
      cuando: now,
    });
    void notificador
      .send({ to: req.actor.email, ...aviso })
      .then((r) => { if (!r.sent) app.log.warn({ err: r.error }, "aviso de consulta no enviado"); })
      .catch((err) => app.log.warn({ err }, "aviso de consulta no enviado"));

    return respuesta;
  });
}
