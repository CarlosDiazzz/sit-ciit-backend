import type { Pool } from "pg";
import { ManagementStore } from "./management/store.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  EmailAlreadyExistsError,
  type UserRecord,
  type UserRepository,
} from "../../../domain/ports/UserRepository.js";
import { requireRole } from "./authGuard.js";

const ROLES = [
  "admin",
  "control_center",
  "operator",
  "cliente",
  "technician",
  "auditor",
] as const;

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLES),
});

const updateSchema = z.object({
  role: z.enum(ROLES).optional(),
  password: z.string().min(8).optional(),
});

function toResponse(u: UserRecord) {
  return { ...u, createdAt: u.createdAt.toISOString() };
}

/** CRUD de usuarios — todo bajo requireRole('control_center'): son cuentas
 *  de otras personas, no algo que un operador o cliente deba tocar. */
export function registerUserRoutes(
  app: FastifyInstance,
  users: UserRepository,
  pool: Pool,
): void {
  const onlyControlCenter = {
    preHandler: requireRole("admin", "control_center"),
  };

  app.get("/users", onlyControlCenter, async () => {
    const list = await users.listAll();
    return list.map(toResponse);
  });

  app.post("/users", onlyControlCenter, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "body inválido", issues: parsed.error.issues });
    }

    try {
      const created = await new ManagementStore(pool).write(
        "users",
        null,
        request.actor,
        parsed.data,
      );
      const record = await users.findById(created.id);
      return reply.code(201).send(record ? toResponse(record) : created);
    } catch (err) {
      if (err instanceof EmailAlreadyExistsError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  app.patch("/users/:id", onlyControlCenter, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "body inválido", issues: parsed.error.issues });
    }
    if (!parsed.data.role && !parsed.data.password) {
      return reply
        .code(400)
        .send({ error: "nada que actualizar: manda role y/o password" });
    }

    const updated = await new ManagementStore(pool).write(
      "users",
      id,
      request.actor,
      parsed.data,
    );
    const record = await users.findById(updated.id);
    return record ? toResponse(record) : updated;
  });

  app.delete("/users/:id", onlyControlCenter, async (request, reply) => {
    const { id } = request.params as { id: string };

    // Evita quedarse sin acceso por accidente: nadie se borra a sí mismo.
    if (request.authUser?.id === id) {
      return reply
        .code(400)
        .send({ error: "no puedes borrar tu propio usuario" });
    }

    const ok = await new ManagementStore(pool)
      .archive("users", id, request.actor)
      .then(() => true);
    if (!ok) return reply.code(404).send({ error: "usuario no encontrado" });
    return reply.code(204).send();
  });
}
