import type { Pool } from "pg";

import type {
  BackendEvent,
  BackendEventKind,
  DeviceEventToRecord,
  EventListItem,
  EventVerdict,
  EventRepository,
} from "../../../domain/ports/EventRepository.js";
import { findNodeId } from "./findNodeId.js";

interface EventRow {
  id: string;
  unit_id: string;
  node_id: string | null;
  unit_code?: string;
  node_code?: string | null;
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
  verdict: EventVerdict | null;
  verdict_note: string | null;
  details: Record<string, unknown> | null;
}

const EVENT_COLUMNS = `id, unit_id, node_id, kind, severity, value, threshold,
              gps_lat, gps_lon, ts, received_at, acknowledged_at, acknowledged_by, details,
              verdict, verdict_note`;

function toListItem(r: EventRow): EventListItem {
  return {
    verdict: r.verdict,
    verdictNote: r.verdict_note,
    id: r.id,
    unitId: r.unit_id,
    nodeId: r.node_id,
    // Codigos del contrato ("unit-01", "unit-01-a"): son lo que el
    // operador reconoce. Los UUID se conservan porque la vista agrupa
    // por ellos, pero un UUID en pantalla no dice nada.
    unitCode: r.unit_code ?? null,
    nodeCode: r.node_code ?? null,
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
      `INSERT INTO events (msg_id, unit_id, node_id, kind, severity, ts, details, gps_lat, gps_lon)
       VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        event.unitId,
        event.nodeId,
        event.kind,
        event.severity,
        event.ts,
        event.details ?? null,
        event.gps?.lat ?? null,
        event.gps?.lon ?? null,
      ]
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
      `SELECT ${EVENT_COLUMNS.split(', ').map((c) => `e.${c.trim()}`).join(', ')},
              u.unit_code, n.node_code
         FROM events e
         JOIN units u ON u.id = e.unit_id
         LEFT JOIN nodes n ON n.id = e.node_id
        ORDER BY e.ts DESC
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

  async setVerdict(
    eventId: string,
    userId: string,
    verdict: EventVerdict,
    note: string | null
  ): Promise<boolean> {
    // Sin la condicion de "solo si esta vacio" que tiene acknowledge:
    // un operador que se equivoca debe poder corregir su juicio en vez
    // de dejar una etiqueta falsa en el dataset. Se marca tambien como
    // revisado, porque dar un veredicto implica haberlo visto.
    const { rowCount } = await this.pool.query(
      `UPDATE events
          SET verdict = $3, verdict_note = $4,
              acknowledged_at = COALESCE(acknowledged_at, now()),
              acknowledged_by = COALESCE(acknowledged_by, $2)
        WHERE id = $1`,
      [eventId, userId, verdict, note]
    );
    return (rowCount ?? 0) > 0;
  }
}
