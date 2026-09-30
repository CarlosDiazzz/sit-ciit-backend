import type { Pool } from "pg";
import { ManagementStore, audit } from "./management/store.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { NodeConflictError } from "../../../adapters/out/postgres/PgNodeCredentialRepository.js";
import type {
  NodeCredential,
  NodeCredentialRepository,
} from "../../../domain/ports/NodeCredentialRepository.js";
import { requireRole } from "./authGuard.js";

const createSchema = z.object({
  nodeCode: z.string().min(1),
  unitCode: z.string().min(1),
  role: z.enum(["primary", "backup"]),
});

function toResponse(n: NodeCredential) {
  return { ...n, createdAt: n.createdAt.toISOString() };
}

/** CRUD de nodos — todo bajo requireRole('control_center'): el secreto
 *  que genera es lo único que autentica a un celular como un nodo real,
 *  no algo que un operador o cliente deba poder emitir. */
export function registerNodeRoutes(
  app: FastifyInstance,
  nodes: NodeCredentialRepository,
  pool: Pool,
): void {
  const onlyControlCenter = {
    preHandler: requireRole("admin", "control_center"),
  };

  app.get("/nodes", onlyControlCenter, async () => {
    const list = await nodes.listAll();
    return list.map(toResponse);
  });

  app.post("/nodes", onlyControlCenter, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "body inválido", issues: parsed.error.issues });
    }

    try {
      const { node, secret } = await nodes.create(
        parsed.data.nodeCode,
        parsed.data.unitCode,
        parsed.data.role,
      );
      await new ManagementStore(pool).transaction((db) =>
        audit(db, request.actor, "nodes", node.id, "create", null, { ...node }),
      );
      return reply.code(201).send({ ...toResponse(node), secret });
    } catch (err) {
      if (err instanceof NodeConflictError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post(
    "/nodes/:id/regenerate-secret",
    onlyControlCenter,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const secret = await nodes.regenerateSecret(id);
      if (!secret) return reply.code(404).send({ error: "nodo no encontrado" });
      await new ManagementStore(pool).transaction((db) =>
        audit(db, request.actor, "nodes", id, "rotate-secret", null, null),
      );
      return { secret };
    },
  );

  app.post(
    "/nodes/:id/reactivate",
    onlyControlCenter,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { rows } = await pool.query(
        "SELECT n.id,u.active FROM nodes n JOIN units u ON u.id=n.unit_id WHERE n.id=$1",
        [id],
      );
      if (!rows.length)
        return reply.code(404).send({ message: "Dispositivo no encontrado." });
      if (!rows[0].active)
        return reply.code(409).send({ message: "Reactiva la unidad primero." });
      const secret = await nodes.regenerateSecret(id);
      await new ManagementStore(pool).transaction(async (db) => {
        await db.query(
          "UPDATE nodes SET active=true,updated_at=now() WHERE id=$1",
          [id],
        );
        await audit(db, request.actor, "nodes", id, "reactivate", null, {
          id,
          active: true,
        });
      });
      return { secret };
    },
  );

  app.delete("/nodes/:id", onlyControlCenter, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = await new ManagementStore(pool)
      .archive("nodes", id, request.actor)
      .then(() => true);
    if (!ok) return reply.code(404).send({ error: "nodo no encontrado" });
    return reply.code(204).send();
  });
}
