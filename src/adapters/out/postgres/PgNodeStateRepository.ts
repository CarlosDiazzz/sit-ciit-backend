import type { Pool } from "pg";

import type {
  HeartbeatState,
  NodeLiveness,
  NodeStateRepository,
} from "../../../domain/ports/NodeStateRepository.js";

interface LivenessRow {
  id: string;
  node_code: string;
  unit_id: string;
  unit_code: string;
  role: "primary" | "backup";
  is_online: boolean;
  last_heartbeat_at: Date | null;
  active_node_id: string | null;
}

const LIVENESS_SELECT = `
  SELECT n.id, n.node_code, n.unit_id, u.unit_code, n.role,
         n.is_online, n.last_heartbeat_at, u.active_node_id
    FROM nodes n
    JOIN units u ON u.id = n.unit_id`;

function toLiveness(r: LivenessRow): NodeLiveness {
  return {
    id: r.id,
    nodeCode: r.node_code,
    unitId: r.unit_id,
    unitCode: r.unit_code,
    role: r.role,
    isOnline: r.is_online,
    lastHeartbeatAt: r.last_heartbeat_at,
    activeNodeId: r.active_node_id,
  };
}

export class PgNodeStateRepository implements NodeStateRepository {
  constructor(private readonly pool: Pool) {}

  async applyHeartbeat(state: HeartbeatState): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Mismo upsert que la ingesta de telemetría: el contrato no define
      // un flujo de alta de nodos, así que el primer mensaje de un
      // nodeId nuevo lo da de alta.
      const { rows: unitRows } = await client.query<{ id: string }>(
        `INSERT INTO units (unit_code) VALUES ($1)
         ON CONFLICT (unit_code) DO UPDATE SET unit_code = units.unit_code
         RETURNING id`,
        [state.node.unitCode]
      );
      const unitId = unitRows[0]!.id;

      const { rows: nodeRows } = await client.query<{ id: string }>(
        `INSERT INTO nodes (node_code, unit_id, role, is_online,
                            last_heartbeat_at, battery_pct, pending_outbox,
                            sampling_ms, mode)
         VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8)
         ON CONFLICT (node_code) DO UPDATE SET
           unit_id = EXCLUDED.unit_id,
           role = EXCLUDED.role,
           is_online = true,
           last_heartbeat_at = EXCLUDED.last_heartbeat_at,
           battery_pct = EXCLUDED.battery_pct,
           pending_outbox = EXCLUDED.pending_outbox,
           sampling_ms = EXCLUDED.sampling_ms,
           mode = EXCLUDED.mode
         RETURNING id`,
        [
          state.node.nodeCode,
          unitId,
          state.node.role,
          state.receivedAt,
          state.batteryPct ?? null,
          state.pendingOutbox,
          state.samplingMs,
          state.mode,
        ]
      );
      const nodeId = nodeRows[0]!.id;

      // Las capabilities se reemplazan enteras: el heartbeat manda la
      // lista completa de sensores disponibles ahora mismo, y un sensor
      // puede dejar de estarlo.
      await client.query(`DELETE FROM node_capabilities WHERE node_id = $1`, [nodeId]);
      if (state.capabilities.length > 0) {
        await client.query(
          `INSERT INTO node_capabilities (node_id, capability)
           SELECT $1, UNNEST($2::text[])
           ON CONFLICT DO NOTHING`,
          [nodeId, state.capabilities]
        );
      }

      // Si la unidad no tenía fuente activa, este nodo la toma: es el
      // primero que da señales de vida.
      await client.query(
        `UPDATE units SET active_node_id = $2
          WHERE id = $1 AND active_node_id IS NULL`,
        [unitId, nodeId]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async findStaleOnlineNodes(olderThan: Date): Promise<NodeLiveness[]> {
    const { rows } = await this.pool.query<LivenessRow>(
      `${LIVENESS_SELECT}
        WHERE n.is_online = true
          AND (n.last_heartbeat_at IS NULL OR n.last_heartbeat_at < $1)`,
      [olderThan]
    );
    return rows.map(toLiveness);
  }

  async findNodesOfUnit(unitId: string): Promise<NodeLiveness[]> {
    const { rows } = await this.pool.query<LivenessRow>(
      `${LIVENESS_SELECT} WHERE n.unit_id = $1`,
      [unitId]
    );
    return rows.map(toLiveness);
  }

  async findByNodeCode(nodeCode: string): Promise<NodeLiveness | null> {
    const { rows } = await this.pool.query<LivenessRow>(
      `${LIVENESS_SELECT} WHERE n.node_code = $1`,
      [nodeCode]
    );
    return rows[0] ? toLiveness(rows[0]) : null;
  }

  async setOnline(nodeId: string, isOnline: boolean): Promise<void> {
    await this.pool.query(`UPDATE nodes SET is_online = $2 WHERE id = $1`, [nodeId, isOnline]);
  }

  async setActiveNode(unitId: string, nodeId: string | null): Promise<void> {
    await this.pool.query(`UPDATE units SET active_node_id = $2 WHERE id = $1`, [unitId, nodeId]);
  }
}
