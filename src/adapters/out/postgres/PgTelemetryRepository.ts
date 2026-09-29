import type { Pool, PoolClient } from "pg";

import type {
  NodeRef,
  SaveTelemetryResult,
  TelemetryReading,
  TelemetryRepository,
} from "../../../domain/ports/TelemetryRepository.js";

export class PgTelemetryRepository implements TelemetryRepository {
  constructor(private readonly pool: Pool) {}

  async save(reading: TelemetryReading): Promise<SaveTelemetryResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const nodeId = await this.ensureNode(client, reading.node);

      const { rows } = await client.query(
        `INSERT INTO telemetry (
           msg_id, node_id, seq, ts, received_at,
           accel_x, accel_y, accel_z,
           gyro_x, gyro_y, gyro_z,
           lux, pressure_hpa,
           gps_lat, gps_lon, gps_speed_ms, gps_accuracy_m
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
          reading.lux ?? null,
          reading.pressureHpa ?? null,
          reading.gps?.lat ?? null,
          reading.gps?.lon ?? null,
          reading.gps?.speedMs ?? null,
          reading.gps?.accuracyM ?? null,
        ]
      );

      await client.query(
        `UPDATE nodes SET is_online = true, last_heartbeat_at = now() WHERE id = $1`,
        [nodeId]
      );

      await client.query("COMMIT");
      return { inserted: rows.length > 0 };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Da de alta unit/node en el primer mensaje que se ve de ellos (los nodos
   * no se registran por separado — el contrato no define un endpoint de
   * alta, así que la primera telemetry/evento/heartbeat "matricula" al nodo).
   */
  private async ensureNode(client: PoolClient, node: NodeRef): Promise<string> {
    const unitResult = await client.query<{ id: string }>(
      `INSERT INTO units (unit_code) VALUES ($1)
       ON CONFLICT (unit_code) DO UPDATE SET unit_code = units.unit_code
       RETURNING id`,
      [node.unitCode]
    );
    const unitId = unitResult.rows[0].id;

    const nodeResult = await client.query<{ id: string }>(
      `INSERT INTO nodes (node_code, unit_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (node_code) DO UPDATE SET unit_id = EXCLUDED.unit_id
       RETURNING id`,
      [node.nodeCode, unitId, node.role]
    );
    return nodeResult.rows[0].id;
  }
}
