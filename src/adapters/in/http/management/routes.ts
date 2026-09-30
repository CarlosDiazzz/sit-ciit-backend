import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { IssueCommand } from "../../../../application/issueCommand.js";
import { z } from "zod";
import {
  resources,
  bodySchema,
} from "../../../../domain/management/resources.js";
import { ManagementStore, audit } from "./store.js";
import { ManagementError, assertUnit, unitIds } from "./access.js";
const idSchema = z.string().uuid();
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(250).optional(),
  archived: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export function registerManagementRoutes(
  app: FastifyInstance,
  pool: Pool,
  issueCommand?: IssueCommand,
) {
  const store = new ManagementStore(pool);
  app.get("/management/resources", async (req) =>
    Object.entries(resources)
      .filter(([, r]) => r.readRoles.includes(req.actor.role))
      .map(([key, r]) => ({
        key,
        label: r.label,
        fields: r.fields,
        canWrite: r.writeRoles.includes(req.actor.role),
        canCreate:
          key !== "nodes" &&
          !(key === "maintenance" && req.actor.role === "technician") &&
          r.writeRoles.includes(req.actor.role),
      })),
  );
  app.get("/management/options/:resource", async (req) => {
    const { resource } = req.params as { resource: string };
    if (
      req.actor.role === "cliente" &&
      !["companies", "shipments", "trips", "trip-shipments"].includes(resource)
    )
      throw new ManagementError(403, "Catálogo fuera de tu ámbito.");
    if (!resources[resource] && resource !== "events")
      throw new ManagementError(404, "Catálogo no encontrado.");
    return store.options(resource, req.actor);
  });
  for (const [key, res] of Object.entries(resources)) {
    const read = async (req: any) => {
      if (!res.readRoles.includes(req.actor.role))
        throw new ManagementError(
          403,
          "No tienes permiso para consultar este módulo.",
        );
    };
    const write = async (req: any) => {
      if (!res.writeRoles.includes(req.actor.role))
        throw new ManagementError(
          403,
          "No tienes permiso para modificar este módulo.",
        );
    };
    app.get(`/management/${key}`, { preHandler: read }, async (req, reply) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success)
        return reply.code(400).send({ message: "Filtros inválidos." });
      return store.list(key, req.actor, parsed.data);
    });
    app.get(`/management/${key}/:id`, { preHandler: read }, async (req) =>
      store.get(
        key,
        idSchema.parse((req.params as { id: string }).id),
        req.actor,
      ),
    );
    app.post(
      `/management/${key}`,
      { preHandler: write },
      async (req, reply) => {
        if (key === "nodes")
          throw new ManagementError(
            400,
            "Registra el dispositivo desde Nodos para generar su secreto.",
          );
        const parsed = bodySchema(res).safeParse(req.body);
        if (!parsed.success)
          return reply.code(400).send({
            message: parsed.error.issues
              .map(
                (i) =>
                  `${res.fields.find((f) => f.key === i.path[0])?.label ?? i.path.join(".")}: ${i.message}`,
              )
              .join("; "),
          });
        return reply
          .code(201)
          .send(await store.write(key, null, req.actor, parsed.data));
      },
    );
    app.patch(
      `/management/${key}/:id`,
      { preHandler: write },
      async (req, reply) => {
        const id = idSchema.safeParse((req.params as { id: string }).id);
        if (!id.success)
          throw new ManagementError(400, "Identificador inválido.");
        const parsed = bodySchema(res, true).safeParse(req.body);
        if (!parsed.success)
          return reply.code(400).send({
            message: parsed.error.issues
              .map(
                (i) =>
                  `${res.fields.find((f) => f.key === i.path[0])?.label ?? i.path.join(".")}: ${i.message}`,
              )
              .join("; "),
          });
        if (!Object.keys(parsed.data).length)
          throw new ManagementError(400, "No hay cambios para guardar.");
        if (parsed.data.active === false)
          throw new ManagementError(
            400,
            "Usa la acción Archivar para dar de baja el registro.",
          );
        if (key === "nodes" && parsed.data.active === true)
          throw new ManagementError(
            400,
            "Reactiva dispositivos desde el flujo de aprovisionamiento.",
          );
        return store.write(key, id.data, req.actor, parsed.data);
      },
    );
    app.delete(
      `/management/${key}/:id`,
      { preHandler: write },
      async (req, reply) => {
        const id = idSchema.safeParse((req.params as { id: string }).id);
        if (!id.success)
          throw new ManagementError(400, "Identificador inválido.");
        await store.archive(key, id.data, req.actor);
        return reply.code(204).send();
      },
    );
  }
  app.get("/management/incidents/:id/notes", async (req) => {
    const id = idSchema.parse((req.params as { id: string }).id);
    await store.get("incidents", id, req.actor);
    const { rows } = await pool.query(
      "SELECT n.*,u.email author FROM incident_notes n JOIN users u ON u.id=n.user_id WHERE incident_id=$1 ORDER BY created_at",
      [id],
    );
    return rows;
  });
  app.post("/management/incidents/:id/notes", async (req, reply) => {
    if (!["admin", "control_center", "operator"].includes(req.actor.role))
      throw new ManagementError(403, "No puedes comentar incidentes.");
    const id = idSchema.parse((req.params as { id: string }).id);
    const parsed = z
      .object({
        body: z.string().trim().min(1).max(10000),
        evidence_url: z
          .string()
          .url()
          .refine((v) => /^https?:\/\//.test(v))
          .nullable()
          .optional(),
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success)
      throw new ManagementError(
        400,
        "Comentario o enlace de evidencia inválido.",
      );
    const note = await store.transaction(async (db) => {
      const incident = await store.get("incidents", id, req.actor, db, true);
      if (["resolved", "dismissed"].includes(incident.status))
        throw new ManagementError(409, "El incidente ya está cerrado.");
      const { rows } = await db.query(
        "INSERT INTO incident_notes(incident_id,user_id,body,evidence_url) VALUES($1,$2,$3,$4) RETURNING *",
        [id, req.actor.id, parsed.data.body, parsed.data.evidence_url ?? null],
      );
      await audit(
        db,
        req.actor,
        "incident-notes",
        rows[0].id,
        "create",
        null,
        rows[0],
      );
      return rows[0];
    });
    return reply.code(201).send(note);
  });
  app.post("/management/monitoring-profiles/:id/apply", async (req, reply) => {
    if (!["admin", "control_center"].includes(req.actor.role))
      throw new ManagementError(
        403,
        "Solo el centro de control aplica configuraciones.",
      );
    const profile = await store.get(
      "monitoring-profiles",
      idSchema.parse((req.params as { id: string }).id),
      req.actor,
    );
    const input = z
      .object({ node_id: z.string().uuid() })
      .strict()
      .safeParse(req.body);
    if (!input.success || !issueCommand)
      throw new ManagementError(400, "Selecciona un dispositivo válido.");
    const node = await store.get("nodes", input.data.node_id, req.actor);
    if (!node.active || !profile.active)
      throw new ManagementError(
        409,
        "El perfil y el dispositivo deben estar activos.",
      );
    const limitations = [
      "El nodo actual aplica muestreo y umbral de impacto. Luz, límites ambientales internos y activación individual de sensores quedan como configuración deseada pendiente de compatibilidad.",
    ];
    const result = await store.transaction(async (db) => {
      const { rows } = await db.query(
        "INSERT INTO profile_applications(profile_id,node_id,issued_by,profile_version,desired_config) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [profile.id, node.id, req.actor.id, profile.version, profile],
      );
      await audit(
        db,
        req.actor,
        "profile-applications",
        rows[0].id,
        "create",
        null,
        rows[0],
      );
      return rows[0];
    });
    const commands = [];
    for (const command of [
      {
        action: "set_sampling_rate" as const,
        params: { samplingMs: profile.sampling_ms },
      },
      ...(profile.impact_threshold_g
        ? [
            {
              action: "set_thresholds" as const,
              params: { impactG: profile.impact_threshold_g },
            },
          ]
        : []),
    ]) {
      const issued = await issueCommand({
        targetNodeCode: node.node_code,
        action: command.action,
        params: command.params,
        issuedBy: { userId: req.actor.id, role: "control_center" },
      });
      if (!issued.ok)
        throw new ManagementError(
          409,
          "No se pudo emitir la configuración. Revisa el historial antes de reintentar.",
        );
      await pool.query(
        "INSERT INTO profile_application_commands(application_id,command_id) VALUES($1,$2)",
        [result.id, issued.command.id],
      );
      commands.push(issued.command);
    }
    return reply.code(201).send({ application: result, commands, limitations });
  });
  app.get("/management/monitoring-profiles/:id/applications", async (req) => {
    if (!["admin", "control_center", "auditor"].includes(req.actor.role))
      throw new ManagementError(
        403,
        "No tienes acceso al historial de aplicación.",
      );
    const id = idSchema.parse((req.params as { id: string }).id);
    const { rows } = await pool.query(
      `SELECT a.*,n.node_code,coalesce(jsonb_agg(jsonb_build_object('action',c.action,'status',c.status,'reason',c.reason,'cmd_id',c.cmd_id)) FILTER(WHERE c.id IS NOT NULL),'[]') commands FROM profile_applications a JOIN nodes n ON n.id=a.node_id LEFT JOIN profile_application_commands ac ON ac.application_id=a.id LEFT JOIN commands c ON c.id=ac.command_id WHERE a.profile_id=$1 GROUP BY a.id,n.node_code ORDER BY a.created_at DESC LIMIT 100`,
      [id],
    );
    return rows;
  });
  app.get("/management/audit", async (req, reply) => {
    if (!["admin", "control_center", "auditor"].includes(req.actor.role))
      throw new ManagementError(403, "No tienes acceso a la auditoría.");
    const q = querySchema.safeParse(req.query);
    if (!q.success)
      return reply.code(400).send({ message: "Filtros inválidos." });
    const { page, limit, search } = q.data;
    const values = [`%${search ?? ""}%`];
    const count = await pool.query(
      "SELECT count(*)::int total FROM audit_log WHERE resource ILIKE $1",
      values,
    );
    const { rows } = await pool.query(
      "SELECT a.*,u.email actor_email FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE a.resource ILIKE $1 ORDER BY a.created_at DESC LIMIT $2 OFFSET $3",
      [...values, limit, (page - 1) * limit],
    );
    return { items: rows, total: count.rows[0].total, page, limit };
  });
  app.get("/management/my-notifications", async (req) => {
    const values: unknown[] = [req.actor.id];
    let scope = "true";
    if (req.actor.role === "cliente") {
      values.push(req.actor.company_id);
      scope =
        "i.trip_id IN (SELECT ts.trip_id FROM trip_shipments ts JOIN shipments s ON s.id=ts.shipment_id WHERE ts.active AND s.company_id=$2)";
    } else {
      const ids = await unitIds(pool, req.actor);
      if (ids !== null) {
        values.push(ids);
        scope = "i.unit_id=ANY($2::uuid[])";
      }
    }
    const { rows } = await pool.query(
      `SELECT d.id,d.created_at,i.name title,i.severity,i.status incident_status FROM notification_deliveries d JOIN notification_rules nr ON nr.id=d.rule_id JOIN incidents i ON i.id=d.incident_id WHERE nr.user_id=$1 AND nr.channel='dashboard' AND d.status='available' AND (${scope}) ORDER BY d.created_at DESC LIMIT 100`,
      values,
    );
    return rows;
  });
  app.get("/management/notification-deliveries", async (req) => {
    if (!["admin", "control_center", "auditor"].includes(req.actor.role))
      throw new ManagementError(
        403,
        "No tienes acceso al historial de notificaciones.",
      );
    const { rows } = await pool.query(
      "SELECT d.*,r.name,r.channel FROM notification_deliveries d JOIN notification_rules r ON r.id=d.rule_id ORDER BY d.created_at DESC LIMIT 200",
    );
    return rows;
  });
  app.get("/management/reports/trips/:id", async (req) => {
    const id = idSchema.parse((req.params as { id: string }).id);
    const trip = await store.get("trips", id, req.actor);
    if (!resources.trips!.readRoles.includes(req.actor.role))
      throw new ManagementError(403, "No tienes acceso a este reporte.");
    const from = trip.actual_departure ?? trip.planned_departure;
    const to =
      trip.actual_arrival ??
      (trip.status === "in_transit" ? new Date() : trip.planned_arrival);
    const { rows } = await pool.query(
      `SELECT count(*)::int samples,min(t.ts) first_sample,max(t.ts) last_sample,
    count(*) FILTER(WHERE received_at-ts>interval '30 seconds')::int delayed_samples,
    avg(gps_speed_ms)*3.6 average_speed_kmh,max(gps_speed_ms)*3.6 max_speed_kmh
    FROM telemetry t JOIN nodes n ON n.id=t.node_id WHERE n.unit_id=$1 AND t.ts BETWEEN $2 AND $3`,
      [trip.unit_id, from, to],
    );
    const incidents = await pool.query(
      "SELECT status,count(*)::int count FROM incidents WHERE trip_id=$1 GROUP BY status",
      [id],
    );
    const cargo = await pool.query(
      `SELECT s.code,s.name,s.weight_kg,s.status FROM trip_shipments ts JOIN shipments s ON s.id=ts.shipment_id WHERE ts.trip_id=$1 AND ts.active ${req.actor.role === "cliente" ? "AND s.company_id=$2" : ""}`,
      [id, ...(req.actor.role === "cliente" ? [req.actor.company_id] : [])],
    );
    return {
      trip,
      period: { from, to },
      telemetry: rows[0],
      incidents: incidents.rows,
      shipments: cargo.rows,
      limitations: [
        "La velocidad incluye las fuentes almacenadas por los nodos; una estimación inercial no equivale a una medición GPS.",
        "No hay historial de heartbeat: el reporte no calcula disponibilidad ni duración exacta de desconexiones.",
      ],
    };
  });
}
