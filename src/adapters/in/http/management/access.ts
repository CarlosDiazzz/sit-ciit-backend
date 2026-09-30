import type { Pool, PoolClient } from "pg";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyToken } from "../../../../domain/jwt.js";
import type { Role } from "../../../../domain/management/resources.js";
export interface Actor {
  id: string;
  email: string;
  role: Role;
  company_id: string | null;
}
declare module "fastify" {
  interface FastifyRequest {
    actor: Actor;
  }
}
export class ManagementError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function loadActor(
  db: Pool | PoolClient,
  id: string,
): Promise<Actor | null> {
  const { rows } = await db.query(
    "SELECT id,email,role,company_id FROM users WHERE id=$1 AND active",
    [id],
  );
  return rows[0] ?? null;
}
export async function unitIds(
  db: Pool | PoolClient,
  actor: Actor,
): Promise<string[] | null> {
  if (["admin", "control_center", "auditor"].includes(actor.role)) return null;
  if (actor.role === "cliente") {
    if (!actor.company_id) return [];
    const { rows } = await db.query(
      `SELECT DISTINCT t.unit_id FROM shipments s
       JOIN companies c ON c.id=s.company_id AND c.active
       JOIN trip_shipments ts ON ts.shipment_id=s.id AND ts.active
       JOIN trips t ON t.id=ts.trip_id AND t.active
       WHERE s.company_id=$1 AND s.active AND s.status='in_transit'
         AND t.status='in_transit' AND t.actual_departure<=now()`,
      [actor.company_id],
    );
    return rows.map((r) => r.unit_id);
  }
  if (actor.role === "technician") {
    const { rows } = await db.query(
      `SELECT DISTINCT n.unit_id FROM maintenance m JOIN nodes n ON n.id=m.node_id WHERE m.technician_id=$1 AND m.active`,
      [actor.id],
    );
    return rows.map((r) => r.unit_id);
  }
  const { rows } = await db.query(
    `SELECT DISTINCT t.unit_id FROM assignments a JOIN trips t ON t.id=a.trip_id
 WHERE a.user_id=$1 AND a.active AND t.active AND a.starts_at<=now() AND (a.ends_at IS NULL OR a.ends_at>=now())`,
    [actor.id],
  );
  return rows.map((r) => r.unit_id);
}
export async function assertUnit(
  db: Pool | PoolClient,
  actor: Actor,
  id: string,
) {
  const ids = await unitIds(db, actor);
  if (ids !== null && !ids.includes(id))
    throw new ManagementError(403, "No tienes acceso a esta unidad.");
}
export async function assertTrip(
  db: Pool | PoolClient,
  actor: Actor,
  id: string,
) {
  if (["admin", "control_center", "auditor"].includes(actor.role)) return;
  const { rows } = await db.query(
    `SELECT id FROM assignments WHERE trip_id=$1 AND user_id=$2 AND active AND starts_at<=now() AND (ends_at IS NULL OR ends_at>=now())`,
    [id, actor.id],
  );
  if (!rows.length)
    throw new ManagementError(403, "El viaje no está asignado a tu cuenta.");
}
export function registerAccess(app: FastifyInstance, pool: Pool) {
  app.addHook("preHandler", async (req, reply) => {
    if (["/health", "/auth/login"].includes(req.routeOptions.url ?? "")) return;
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ")
      ? verifyToken(header.slice(7))
      : null;
    const actor = token ? await loadActor(pool, token.id) : null;
    if (!actor)
      return reply
        .code(401)
        .send({ message: "Inicia sesión con una cuenta activa." });
    req.actor = actor;
    req.authUser = { id: actor.id, email: actor.email, role: actor.role };
    if (actor.role === "cliente" && !req.url.startsWith("/management/") &&
        !["/customer/session", "/customer/tracking"].includes(req.routeOptions.url ?? ""))
      return reply.code(403).send({ message: "Usa el portal de tus envíos." });
    const url = req.routeOptions.url ?? "";
    const params = req.params as Record<string, string>;
    if (url.startsWith("/units/:id")) await assertUnit(pool, actor, params.id!);
    if (url === "/telemetry") {
      const code = (req.query as Record<string, string>).unitId;
      const { rows } = await pool.query(
        "SELECT id FROM units WHERE unit_code=$1",
        [code],
      );
      if (!rows.length) throw new ManagementError(404, "Unidad no encontrada.");
      await assertUnit(pool, actor, rows[0].id);
    }
    if (url === "/commands" && req.method === "POST") {
      const code = (req.body as Record<string, unknown>)?.targetNodeId;
      const { rows } = await pool.query(
        "SELECT unit_id FROM nodes WHERE node_code=$1 AND active",
        [typeof code === "string" ? code : null],
      );
      if (!rows.length)
        throw new ManagementError(
          404,
          "Dispositivo no encontrado o desactivado.",
        );
      await assertUnit(pool, actor, rows[0].unit_id);
    }
    if (url === "/events/:id/ack") {
      const { rows } = await pool.query(
        "SELECT unit_id FROM events WHERE id=$1",
        [params.id],
      );
      if (!rows.length) throw new ManagementError(404, "Evento no encontrado.");
      await assertUnit(pool, actor, rows[0].unit_id);
    }
  });
  app.setErrorHandler((err, _req, reply) => {
    const code = (err as { code?: string }).code;
    if ((err as { name?: string }).name === "ZodError")
      return reply
        .code(400)
        .send({ message: "Identificador o datos inválidos." });
    if (err instanceof ManagementError)
      return reply.code(err.status).send({ message: err.message });
    if (code === "23505")
      return reply.code(409).send({
        message: "Ya existe un registro con ese código o esa asignación.",
      });
    if (code === "23503")
      return reply.code(409).send({
        message: "El registro relacionado no existe o todavía está en uso.",
      });
    if (["23514", "23502", "22P02", "22007", "22008"].includes(code ?? ""))
      return reply
        .code(400)
        .send({ message: "Los datos no cumplen las reglas del registro." });
    const failure = err as { statusCode?: number; message?: string };
    app.log.error(err);
    return reply.code(failure.statusCode ?? 500).send({
      message:
        failure.statusCode && failure.statusCode < 500
          ? failure.message
          : "No se pudo completar la operación.",
    });
  });
}
export async function filterLegacy<T>(
  pool: Pool,
  req: FastifyRequest,
  items: T[],
  kind: "units" | "events" | "commands",
): Promise<T[]> {
  const ids = await unitIds(pool, req.actor);
  if (ids === null) return items;
  if (kind === "units")
    return items.filter((i) => ids.includes((i as { id: string }).id));
  const { rows } = await pool.query(
    "SELECT u.unit_code,n.node_code FROM units u LEFT JOIN nodes n ON n.unit_id=u.id WHERE u.id=ANY($1::uuid[])",
    [ids],
  );
  if (kind === "events")
    return items.filter((i) => ids.includes((i as { unitId: string }).unitId));
  const codes = new Set(rows.map((r) => r.node_code));
  return items.filter((i) =>
    codes.has((i as { targetNodeCode: string }).targetNodeCode),
  );
}
