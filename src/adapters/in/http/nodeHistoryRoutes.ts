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
