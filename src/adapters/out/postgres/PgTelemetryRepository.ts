import type { Pool } from "pg";

import type {
  SaveTelemetryResult,
  TelemetryReading,
  TelemetryRepository,
  UnitPosition,
} from "../../../domain/ports/TelemetryRepository.js";
import { findNodeId } from "./findNodeId.js";

export class PgTelemetryRepository implements TelemetryRepository {
  constructor(private readonly pool: Pool) {}

  async save(reading: TelemetryReading): Promise<SaveTelemetryResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const nodeId = await findNodeId(client, reading.node.nodeCode);
      if (!nodeId) {
        await client.query("ROLLBACK");
        return { inserted: false };
      }

      const { rows } = await client.query(
        `INSERT INTO telemetry (
           msg_id, node_id, seq, ts, received_at,
           accel_x, accel_y, accel_z,
           gyro_x, gyro_y, gyro_z,
           mag_x, mag_y, mag_z,
           lux, pressure_hpa,
           gps_lat, gps_lon, gps_speed_ms, gps_accuracy_m
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (msg_id, ts) DO NOTHING
         RETURNING id`,
        [
          reading.msgId,
          nodeId,
          reading.seq,
          reading.ts,
          reading.receivedAt,
          reading.accel?.x ?? null,
          reading.accel?.y ?? null,
          reading.accel?.z ?? null,
          reading.gyro?.x ?? null,
          reading.gyro?.y ?? null,
          reading.gyro?.z ?? null,
          reading.mag?.x ?? null,
          reading.mag?.y ?? null,
          reading.mag?.z ?? null,
          reading.lux ?? null,
          reading.pressureHpa ?? null,
          reading.gps?.lat ?? null,
          reading.gps?.lon ?? null,
          reading.gps?.speedMs ?? null,
          reading.gps?.accuracyM ?? null,
        ]
      );

      // La liveness (is_online/last_heartbeat_at) ya no se toca aquí desde
      // que existe el heartbeat real (Fase 5, PgNodeStateRepository): que
      // telemetry siga llegando no prueba que el nodo esté sano si el
      // heartbeat dejó de publicarse, y antes esto podía tapar esa falla.

      await client.query("COMMIT");
      return { inserted: rows.length > 0 };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async findLatestPosition(unitId: string): Promise<UnitPosition | null> {
    const { rows } = await this.pool.query<{ gps_lat: string; gps_lon: string }>(
      `SELECT t.gps_lat, t.gps_lon
         FROM telemetry t
         JOIN nodes n ON n.id = t.node_id
        WHERE n.unit_id = $1 AND t.gps_lat IS NOT NULL AND t.gps_lon IS NOT NULL
        ORDER BY t.ts DESC
        LIMIT 1`,
      [unitId]
    );
    const row = rows[0];
    if (!row) return null;
    return { lat: Number(row.gps_lat), lon: Number(row.gps_lon) };
  }

  async findLatestPositionForNode(nodeId: string): Promise<UnitPosition | null> {
    const { rows } = await this.pool.query<{ gps_lat: string; gps_lon: string }>(
      `SELECT t.gps_lat, t.gps_lon
         FROM telemetry t
        WHERE t.node_id = $1 AND t.gps_lat IS NOT NULL AND t.gps_lon IS NOT NULL
        ORDER BY t.ts DESC
        LIMIT 1`,
      [nodeId]
    );
    const row = rows[0];
    if (!row) return null;
    return { lat: Number(row.gps_lat), lon: Number(row.gps_lon) };
  }
}
