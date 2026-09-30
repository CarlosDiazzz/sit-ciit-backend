import type { Pool } from "pg";

import type {
  HeartbeatState,
  NodeLiveness,
  NodeStateRepository,
} from "../../../domain/ports/NodeStateRepository.js";
import { findNodeId } from "./findNodeId.js";

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

      // El nodo ya debe existir (dado de alta por control_center, su
      // secreto ya se verificó antes de llegar aquí) — ya no se
      // auto-registra con el primer heartbeat que llegue.
      const nodeId = await findNodeId(client, state.node.nodeCode);
      if (!nodeId) {
        await client.query("ROLLBACK");
        return;
      }

      const { rows: nodeRows } = await client.query<{ unit_id: string }>(
        `UPDATE nodes SET
           is_online = true,
           last_heartbeat_at = $2,
           battery_pct = $3,
           pending_outbox = $4,
           sampling_ms = $5,
           mode = $6
         WHERE id = $1
         RETURNING unit_id`,
        [
          nodeId,
          state.receivedAt,
          state.batteryPct ?? null,
          state.pendingOutbox,
          state.samplingMs,
          state.mode,
        ]
      );
      const unitId = nodeRows[0]!.unit_id;

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
