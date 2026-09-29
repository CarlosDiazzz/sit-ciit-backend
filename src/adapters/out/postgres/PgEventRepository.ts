import type { Pool } from "pg";

import type { BackendEvent, EventRepository } from "../../../domain/ports/EventRepository.js";

export class PgEventRepository implements EventRepository {
  constructor(private readonly pool: Pool) {}

  async record(event: BackendEvent): Promise<string> {
    // msg_id queda NULL: estos eventos los genera el backend, no llegan
    // por MQTT, así que no hay msgId del dispositivo que deduplicar.
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO events (msg_id, unit_id, node_id, kind, severity, ts)
       VALUES (NULL, $1, $2, $3, $4, $5)
       RETURNING id`,
      [event.unitId, event.nodeId, event.kind, event.severity, event.ts]
    );
    return rows[0]!.id;
  }
}
