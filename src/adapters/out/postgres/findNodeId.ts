import type { PoolClient } from "pg";

/**
 * Resuelve el UUID de un nodo por su código. Reemplaza al viejo
 * ensureNode: ya no auto-registra nada — el nodo debe existir de
 * antemano (dado de alta por control_center vía el CRUD de Nodos,
 * PgNodeCredentialRepository.create). Si esto devuelve null, el llamador
 * debe tratarlo como "no insertar nada" — no debería pasar nunca en la
 * práctica porque el secreto del nodo ya se verificó antes de llegar
 * aquí (ver adapters/in/mqtt/*Subscriber.ts), pero la fila pudo borrarse
 * entre la verificación y este punto.
 */
export async function findNodeId(client: PoolClient, nodeCode: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM nodes WHERE node_code = $1 AND active`,
    [nodeCode]
  );
  return rows[0]?.id ?? null;
}
