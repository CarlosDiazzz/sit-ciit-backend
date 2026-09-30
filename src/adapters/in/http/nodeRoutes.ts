import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  NodeConflictError,
} from "../../../adapters/out/postgres/PgNodeCredentialRepository.js";
import type { NodeCredential, NodeCredentialRepository } from "../../../domain/ports/NodeCredentialRepository.js";
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
export function registerNodeRoutes(app: FastifyInstance, nodes: NodeCredentialRepository): void {
  const onlyControlCenter = { preHandler: requireRole("control_center") };

  app.get("/nodes", onlyControlCenter, async () => {
    const list = await nodes.listAll();
    return list.map(toResponse);
  });

  app.post("/nodes", onlyControlCenter, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "body inválido", issues: parsed.error.issues });
    }

    try {
      const { node, secret } = await nodes.create(
        parsed.data.nodeCode,
        parsed.data.unitCode,
        parsed.data.role
      );
      return reply.code(201).send({ ...toResponse(node), secret });
    } catch (err) {
      if (err instanceof NodeConflictError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post("/nodes/:id/regenerate-secret", onlyControlCenter, async (request, reply) => {
    const { id } = request.params as { id: string };
    const secret = await nodes.regenerateSecret(id);
    if (!secret) return reply.code(404).send({ error: "nodo no encontrado" });
    return { secret };
  });

  app.delete("/nodes/:id", onlyControlCenter, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = await nodes.delete(id);
    if (!ok) return reply.code(404).send({ error: "nodo no encontrado" });
    return reply.code(204).send();
  });
}
