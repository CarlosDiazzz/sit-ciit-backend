import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { assertUnit, ManagementError, unitIds } from "./management/access.js";
import { serializeTelemetry } from "./telemetryRoutes.js";
const timestamp = z.string().datetime({ offset: true });
const filters = z
  .object({
    nodeId: z.string().uuid(),
    from: timestamp,
    to: timestamp,
    limit: z.coerce.number().int().min(1).max(200).default(100),
    cursor: z.string().max(2000).optional(),
  })
  .strict();
const cursorSchema = z.object({
  nodeId: z.string().uuid(),
  from: timestamp,
  to: timestamp,
  ts: timestamp,
  id: z.string().uuid(),
  snapshot: timestamp,
});
export function registerNodeHistoryRoutes(app: FastifyInstance, pool: Pool) {
  app.get("/node-history/connectivity", async (req, reply) => {
    const parsed = filters.omit({ cursor: true }).safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ message: "Selecciona un nodo y fechas válidas." });
    const q = parsed.data;
    const duration = new Date(q.to).getTime() - new Date(q.from).getTime();
    if (duration < 0 || duration > 31 * 86400000) throw new ManagementError(400, "Consulta periodos de hasta 31 días.");
    const node = await pool.query("SELECT unit_id FROM nodes WHERE id=$1", [q.nodeId]);
    if (!node.rows[0]) throw new ManagementError(404, "Nodo no encontrado.");
    await assertUnit(pool, req.actor, node.rows[0].unit_id);
    // Caída: última posición conocida. Regreso: primera captura GPS posterior,
    // dentro de 5 minutos y antes de la siguiente caída. Nunca reutilizar GPS anterior.
    const { rows } = await pool.query(`
      SELECT e.id,e.kind,e.ts,
        CASE WHEN e.kind='signal_lost' THEN e.gps_lat ELSE p.gps_lat END "gpsLat",
        CASE WHEN e.kind='signal_lost' THEN e.gps_lon ELSE p.gps_lon END "gpsLon",
        p.ts "positionTs"
      FROM events e LEFT JOIN LATERAL (
        SELECT t.gps_lat,t.gps_lon,t.ts FROM telemetry t
        WHERE t.node_id=e.node_id AND t.gps_lat IS NOT NULL AND t.gps_lon IS NOT NULL
          AND ((e.kind='signal_lost' AND t.ts<=e.ts AND t.gps_lat=e.gps_lat AND t.gps_lon=e.gps_lon AND t.received_at<=e.received_at)
            OR (e.kind='signal_recovered' AND t.ts>=e.ts AND t.ts<=e.ts+interval '5 minutes'
              AND NOT EXISTS (SELECT 1 FROM events n WHERE n.node_id=e.node_id AND n.kind='signal_lost' AND n.ts>e.ts AND n.ts<=t.ts)))
        ORDER BY CASE WHEN e.kind='signal_lost' THEN t.ts END DESC,
                 CASE WHEN e.kind='signal_recovered' THEN t.ts END ASC LIMIT 1
      ) p ON true
      WHERE e.node_id=$1 AND e.kind IN ('signal_lost','signal_recovered')
        AND e.ts BETWEEN $2::timestamptz AND $3::timestamptz
      ORDER BY e.ts DESC,e.id DESC LIMIT $4`, [q.nodeId,q.from,q.to,q.limit+1]);
    return { items: rows.slice(0,q.limit), hasMore: rows.length>q.limit };
  });
  app.get("/node-history/nodes", async (req) => {
    const ids = await unitIds(pool, req.actor);
    const { rows } = await pool.query(
      `SELECT n.id,n.node_code "nodeCode",n.label,n.role,n.active,u.unit_code "unitCode",u.label "unitLabel" FROM nodes n JOIN units u ON u.id=n.unit_id ${ids === null ? "" : "WHERE u.id=ANY($1::uuid[])"} ORDER BY n.active DESC,u.unit_code,n.node_code`,
      ids === null ? [] : [ids],
    );
    return rows;
  });
  app.get("/node-history", async (req, reply) => {
    const parsed = filters.safeParse(req.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ message: "Selecciona un nodo y fechas válidas." });
    const q = parsed.data;
    if (new Date(q.from) > new Date(q.to))
      throw new ManagementError(
        400,
        "La fecha inicial debe ser anterior a la final.",
      );
    if (new Date(q.to).getTime() - new Date(q.from).getTime() > 31 * 86400000)
      throw new ManagementError(400, "Consulta periodos de hasta 31 días.");
    const node = await pool.query(
      "SELECT id,node_code,unit_id FROM nodes WHERE id=$1",
      [q.nodeId],
    );
    if (!node.rows[0]) throw new ManagementError(404, "Nodo no encontrado.");
    await assertUnit(pool, req.actor, node.rows[0].unit_id);
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (q.cursor) {
      try {
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(q.cursor, "base64url").toString("utf8")),
        );
      } catch {
        throw new ManagementError(
          400,
          "La página solicitada no es válida. Vuelve a consultar.",
        );
      }
      if (
        cursor.nodeId !== q.nodeId ||
        cursor.from !== q.from ||
        cursor.to !== q.to
      )
        throw new ManagementError(
          400,
          "El cursor no corresponde a estos filtros.",
        );
    }
    const snapshot = cursor?.snapshot ?? new Date().toISOString();
    const values: unknown[] = [q.nodeId, q.from, q.to, snapshot];
    let after = "";
    if (cursor) {
      values.push(cursor.ts, cursor.id);
      after = "AND (t.ts,t.id)<($5::timestamptz,$6::uuid)";
    }
    values.push(q.limit + 1);
    const { rows } = await pool.query(
      `SELECT t.*,n.node_code,n.role,to_char(t.ts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_ts FROM telemetry t JOIN nodes n ON n.id=t.node_id WHERE t.node_id=$1 AND t.ts BETWEEN $2::timestamptz AND $3::timestamptz AND t.received_at<=$4::timestamptz ${after} ORDER BY t.ts DESC,t.id DESC LIMIT $${values.length}`,
      values,
    );
    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    const nextCursor =
      hasMore && last
        ? Buffer.from(
            JSON.stringify({
              nodeId: q.nodeId,
              from: q.from,
              to: q.to,
              ts: last.cursor_ts,
              id: last.id,
              snapshot,
            }),
          ).toString("base64url")
        : null;
    return {
      items: page.map(serializeTelemetry),
      nextCursor,
      hasMore,
      snapshot,
      limit: q.limit,
    };
  });
}
