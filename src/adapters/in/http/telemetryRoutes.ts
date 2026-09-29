import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

const querySchema = z.object({
  unitId: z.string().min(1),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export function registerTelemetryRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/telemetry", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "query inválida", issues: parsed.error.issues });
    }
    const { unitId, from, to } = parsed.data;

    const { rows } = await pool.query(
      `SELECT t.id, t.msg_id, n.node_code, t.seq, t.ts, t.received_at,
              t.accel_x, t.accel_y, t.accel_z,
              t.gyro_x, t.gyro_y, t.gyro_z,
              t.lux, t.pressure_hpa,
              t.gps_lat, t.gps_lon, t.gps_speed_ms, t.gps_accuracy_m
         FROM telemetry t
         JOIN nodes n ON n.id = t.node_id
         JOIN units u ON u.id = n.unit_id
        WHERE u.unit_code = $1
          AND ($2::timestamptz IS NULL OR t.ts >= $2::timestamptz)
          AND ($3::timestamptz IS NULL OR t.ts <= $3::timestamptz)
        ORDER BY t.ts DESC
        LIMIT 500`,
      [unitId, from ?? null, to ?? null]
    );

    return { readings: rows };
  });
}
