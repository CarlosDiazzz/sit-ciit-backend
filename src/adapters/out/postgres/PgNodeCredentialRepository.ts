import { randomBytes } from "node:crypto";
import type { Pool } from "pg";

import { hashPassword, verifyPassword } from "../../../domain/password.js";
import type {
  NodeCredential,
  NodeCredentialRepository,
} from "../../../domain/ports/NodeCredentialRepository.js";

interface NodeRow {
  id: string;
  node_code: string;
  unit_code: string;
  role: "primary" | "backup";
  secret_hash: string | null;
  is_online: boolean;
  active: boolean;
  created_at: Date;
}

/** Lanzada cuando node_code ya existe, o cuando la unidad ya tiene un
 *  nodo con ese rol (UNIQUE (unit_id, role)) — la ruta responde 409. */
export class NodeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeConflictError";
  }
}

const UNIQUE_VIOLATION = "23505";

function toCredential(r: NodeRow): NodeCredential {
  return {
    id: r.id,
    nodeCode: r.node_code,
    unitCode: r.unit_code,
    role: r.role,
    hasSecret: r.secret_hash !== null,
    isOnline: r.is_online,
    active: r.active,
    createdAt: r.created_at,
  };
}

function generateSecret(): string {
  return randomBytes(24).toString("base64url");
}

export class PgNodeCredentialRepository implements NodeCredentialRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    nodeCode: string,
    unitCode: string,
    role: "primary" | "backup",
  ): Promise<{ node: NodeCredential; secret: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Upsert de la unidad: aquí sí es apropiado — lo dispara una acción
      // explícita de control_center, no un mensaje MQTT sin verificar.
      const { rows: unitRows } = await client.query<{
        id: string;
        active: boolean;
      }>(
        `INSERT INTO units (unit_code) VALUES ($1)
         ON CONFLICT (unit_code) DO UPDATE SET unit_code = units.unit_code
         RETURNING id, active`,
        [unitCode],
      );
      const unitId = unitRows[0]!.id;
      if (!unitRows[0]!.active)
        throw new NodeConflictError(
          "Reactiva la unidad antes de registrar un dispositivo.",
        );

      const secret = generateSecret();
      const secretHash = await hashPassword(secret);

      const { rows } = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO nodes (node_code, unit_id, role, secret_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, created_at`,
        [nodeCode, unitId, role, secretHash],
      );

      await client.query("COMMIT");

      return {
        node: {
          id: rows[0]!.id,
          nodeCode,
          unitCode,
          role,
          hasSecret: true,
          isOnline: false,
          active: true,
          createdAt: rows[0]!.created_at,
        },
        secret,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(err)) {
        throw new NodeConflictError(
          `ya existe un nodo '${nodeCode}', o la unidad '${unitCode}' ya tiene un nodo con rol '${role}'`,
        );
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async listAll(): Promise<NodeCredential[]> {
    const { rows } = await this.pool.query<NodeRow>(
      `SELECT n.id, n.node_code, u.unit_code, n.role, n.secret_hash, n.is_online, n.active, n.created_at
         FROM nodes n
         JOIN units u ON u.id = n.unit_id
        ORDER BY n.created_at`,
    );
    return rows.map(toCredential);
  }

  async regenerateSecret(id: string): Promise<string | null> {
    const secret = generateSecret();
    const secretHash = await hashPassword(secret);
    const { rowCount } = await this.pool.query(
      `UPDATE nodes SET secret_hash = $2 WHERE id = $1`,
      [id, secretHash],
    );
    return (rowCount ?? 0) > 0 ? secret : null;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM nodes WHERE id = $1`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  async verifySecret(nodeCode: string, secret: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ secret_hash: string | null }>(
      `SELECT n.secret_hash FROM nodes n JOIN units u ON u.id=n.unit_id WHERE n.node_code = $1 AND n.active AND u.active`,
      [nodeCode],
    );
    const hash = rows[0]?.secret_hash;
    if (!hash) return false;
    return verifyPassword(secret, hash);
  }

  async findIdByCode(nodeCode: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM nodes WHERE node_code = $1 AND active`,
      [nodeCode],
    );
    return rows[0]?.id ?? null;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === UNIQUE_VIOLATION
  );
}
