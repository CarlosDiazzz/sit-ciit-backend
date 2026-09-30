import type { Pool } from "pg";

import type {
  BackendEvent,
  BackendEventKind,
  DeviceEventToRecord,
  EventListItem,
  EventRepository,
} from "../../../domain/ports/EventRepository.js";
import { findNodeId } from "./findNodeId.js";

interface EventRow {
  id: string;
  unit_id: string;
  node_id: string | null;
  kind: EventListItem["kind"];
  severity: EventListItem["severity"];
  value: string | null;
  threshold: string | null;
  gps_lat: string | null;
  gps_lon: string | null;
  ts: Date;
  received_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  details: Record<string, unknown> | null;
}

const EVENT_COLUMNS = `id, unit_id, node_id, kind, severity, value, threshold,
              gps_lat, gps_lon, ts, received_at, acknowledged_at, acknowledged_by, details`;

function toListItem(r: EventRow): EventListItem {
  return {
    id: r.id,
    unitId: r.unit_id,
    nodeId: r.node_id,
    kind: r.kind,
    severity: r.severity,
    // double precision de Postgres puede llegar como string por el driver.
    value: r.value === null ? null : Number(r.value),
    threshold: r.threshold === null ? null : Number(r.threshold),
    gpsLat: r.gps_lat === null ? null : Number(r.gps_lat),
    gpsLon: r.gps_lon === null ? null : Number(r.gps_lon),
    ts: r.ts,
    receivedAt: r.received_at,
    acknowledgedAt: r.acknowledged_at,
    acknowledgedBy: r.acknowledged_by,
    details: r.details,
  };
}

export class PgEventRepository implements EventRepository {
  constructor(private readonly pool: Pool) {}

  async record(event: BackendEvent): Promise<string> {
    // msg_id queda NULL: estos eventos los genera el backend, no llegan
    // por MQTT, así que no hay msgId del dispositivo que deduplicar.
    // details es un objeto plano: pg lo serializa a JSON automáticamente
    // al insertarlo en una columna jsonb.
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO events (msg_id, unit_id, node_id, kind, severity, ts, details)
       VALUES (NULL, $1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [event.unitId, event.nodeId, event.kind, event.severity, event.ts, event.details ?? null]
    );
    return rows[0]!.id;
  }

  async recordDeviceEvent(event: DeviceEventToRecord): Promise<{ inserted: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const nodeId = await findNodeId(client, event.node.nodeCode);
      if (!nodeId) {
        await client.query("ROLLBACK");
        return { inserted: false };
      }

      // unit_id sale de nodes.unit_id (ya resuelto por findNodeId) en vez
      // de otro parámetro: evita mandar unitCode y unitId del mismo
      // insert por dos caminos que podrían desincronizarse.
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO events (
           msg_id, unit_id, node_id, kind, severity, value, threshold,
           gps_lat, gps_lon, ts
         )
         SELECT $1, n.unit_id, $2, $3, $4, $5, $6, $7, $8, $9
           FROM nodes n WHERE n.id = $2
         ON CONFLICT (msg_id) DO NOTHING
         RETURNING id`,
        [
          event.msgId,
          nodeId,
          event.kind,
          event.severity,
          event.value ?? null,
          event.threshold ?? null,
          event.gps?.lat ?? null,
          event.gps?.lon ?? null,
          event.ts,
        ]
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

  async listRecent(limit: number): Promise<EventListItem[]> {
    const { rows } = await this.pool.query<EventRow>(
      `SELECT ${EVENT_COLUMNS}
         FROM events
        ORDER BY ts DESC
        LIMIT $1`,
      [limit]
    );
    return rows.map(toListItem);
  }

  async findLatestByKind(unitId: string, kind: BackendEventKind): Promise<EventListItem | null> {
    const { rows } = await this.pool.query<EventRow>(
      `SELECT ${EVENT_COLUMNS}
         FROM events
        WHERE unit_id = $1 AND kind = $2
        ORDER BY ts DESC
        LIMIT 1`,
      [unitId, kind]
    );
    const row = rows[0];
    return row ? toListItem(row) : null;
  }

  async acknowledge(eventId: string, userId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE events SET acknowledged_at = now(), acknowledged_by = $2
        WHERE id = $1 AND acknowledged_at IS NULL`,
      [eventId, userId]
    );
    return (rowCount ?? 0) > 0;
  }
}
