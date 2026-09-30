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
      `SELECT t.id, t.msg_id, n.node_code, n.role, t.seq, t.ts, t.received_at,
              t.accel_x, t.accel_y, t.accel_z,
              t.gyro_x, t.gyro_y, t.gyro_z,
              t.mag_x, t.mag_y, t.mag_z,
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

    // camelCase + ISO, como el resto de la API — este endpoint era la
    // única excepción (fila cruda de Postgres), y el dashboard lo
    // necesita para rellenar la vista Unidad con historia real al
    // abrir la pantalla, no solo con lo que llegue por socket desde ese
    // momento (antes se veía "vacío" si el nodo no estaba publicando
    // justo en ese instante, aunque hubiera datos recientes guardados).
    return rows.map((r) => ({
      id: r.id,
      msgId: r.msg_id,
      nodeCode: r.node_code,
      role: r.role,
      seq: r.seq,
      ts: r.ts.toISOString(),
      receivedAt: r.received_at.toISOString(),
      accelX: r.accel_x,
      accelY: r.accel_y,
      accelZ: r.accel_z,
      gyroX: r.gyro_x,
      gyroY: r.gyro_y,
      gyroZ: r.gyro_z,
      magX: r.mag_x,
      magY: r.mag_y,
      magZ: r.mag_z,
      lux: r.lux,
      pressureHpa: r.pressure_hpa,
      gpsLat: r.gps_lat,
      gpsLon: r.gps_lon,
      gpsSpeedMs: r.gps_speed_ms,
      gpsAccuracyM: r.gps_accuracy_m,
    }));
  });
}
