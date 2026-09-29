import type { PoolClient } from "pg";

export interface NodeRef {
  nodeCode: string;
  unitCode: string;
  role: "primary" | "backup";
}

/**
 * Da de alta unit/node por upsert en el primer mensaje que se ve de un
 * nodeId/unitId nuevo — el contrato no define un endpoint de alta.
 *
 * Deliberadamente mínimo: solo garantiza que la fila exista y devuelve su
 * UUID. No toca is_online/battery/capabilities/etc — eso es
 * responsabilidad de la ingesta de heartbeat (PgNodeStateRepository), no
 * de esta. Usado por la ingesta de telemetry y de event, que solo
 * necesitan "asegurar que exista" para poder insertar su propia fila.
 */
export async function ensureNode(client: PoolClient, node: NodeRef): Promise<string> {
  const unitResult = await client.query<{ id: string }>(
    `INSERT INTO units (unit_code) VALUES ($1)
     ON CONFLICT (unit_code) DO UPDATE SET unit_code = units.unit_code
     RETURNING id`,
    [node.unitCode]
  );
  const unitId = unitResult.rows[0]!.id;

  const nodeResult = await client.query<{ id: string }>(
    `INSERT INTO nodes (node_code, unit_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (node_code) DO UPDATE SET unit_id = EXCLUDED.unit_id
     RETURNING id`,
    [node.nodeCode, unitId, node.role]
  );
  return nodeResult.rows[0]!.id;
}
