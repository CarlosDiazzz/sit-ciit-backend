import type { Pool } from "pg";

import type {
  NodeState,
  UnitRepository,
  UnitState,
} from "../../../domain/ports/UnitRepository.js";

interface UnitRow {
  id: string;
  unit_code: string;
  label: string | null;
  active_node_id: string | null;
}

interface NodeRow {
  id: string;
  node_code: string;
  unit_id: string;
  role: "primary" | "backup";
  is_online: boolean;
  last_heartbeat_at: Date | null;
  battery_pct: string | null;
  pending_outbox: number | null;
  sampling_ms: number | null;
  mode: NodeState["mode"];
  capabilities: string[] | null;
}

export class PgUnitRepository implements UnitRepository {
  constructor(private readonly pool: Pool) {}

  async listAll(): Promise<UnitState[]> {
    const { rows: unitRows } = await this.pool.query<UnitRow>(
      `SELECT id, unit_code, label, active_node_id
         FROM units
        ORDER BY unit_code`
    );

    // Dos consultas en vez de un JOIN con filas repetidas por unidad: las
    // capabilities viven en su propia tabla y agregarlas en SQL obligaría
    // a un array_agg anidado poco legible. Son pocas filas (una unidad
    // tiene a lo sumo dos nodos).
    const { rows: nodeRows } = await this.pool.query<NodeRow>(
      `SELECT n.id, n.node_code, n.unit_id, n.role, n.is_online,
              n.last_heartbeat_at, n.battery_pct, n.pending_outbox,
              n.sampling_ms, n.mode,
              COALESCE(
                ARRAY_AGG(c.capability) FILTER (WHERE c.capability IS NOT NULL),
                '{}'
              ) AS capabilities
         FROM nodes n
         LEFT JOIN node_capabilities c ON c.node_id = n.id
        GROUP BY n.id
        ORDER BY n.role, n.node_code`
    );

    const byUnit = new Map<string, NodeState[]>();
    for (const r of nodeRows) {
      const node: NodeState = {
        id: r.id,
        nodeCode: r.node_code,
        unitId: r.unit_id,
        role: r.role,
        isOnline: r.is_online,
        lastHeartbeatAt: r.last_heartbeat_at,
        // numeric de Postgres llega como string por el driver: se
        // convierte aquí para que el dashboard reciba un número.
        batteryPct: r.battery_pct === null ? null : Number(r.battery_pct),
        pendingOutbox: r.pending_outbox,
        samplingMs: r.sampling_ms,
        mode: r.mode,
        capabilities: r.capabilities ?? [],
      };
      const list = byUnit.get(r.unit_id);
      if (list) list.push(node);
      else byUnit.set(r.unit_id, [node]);
    }

    return unitRows.map((u) => ({
      id: u.id,
      unitCode: u.unit_code,
      label: u.label,
      activeNodeId: u.active_node_id,
      nodes: byUnit.get(u.id) ?? [],
    }));
  }
}
