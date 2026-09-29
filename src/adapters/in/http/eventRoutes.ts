import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { EventRepository } from "../../../domain/ports/EventRepository.js";

const ackBodySchema = z.object({
  // Temporal: sin auth (Fase 6) no hay JWT del que sacar el usuario: se
  // acepta explícito en el cuerpo. Cuando exista login, sale del token.
  // UUID real porque acknowledged_by es FK a users(id) — no cualquier texto.
  userId: z.string().uuid(),
});

export function registerEventRoutes(app: FastifyInstance, events: EventRepository): void {
  app.get("/events", async (request) => {
    const limit = Math.min(Number((request.query as { limit?: string }).limit) || 100, 500);
    const list = await events.listRecent(limit);

    return list.map((e) => ({
      ...e,
      value: e.value,
      threshold: e.threshold,
      ts: e.ts.toISOString(),
      receivedAt: e.receivedAt.toISOString(),
      acknowledgedAt: e.acknowledgedAt ? e.acknowledgedAt.toISOString() : null,
    }));
  });

  app.post("/events/:id/ack", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ackBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "body inválido", issues: parsed.error.issues });
    }

    const ok = await events.acknowledge(id, parsed.data.userId);
    if (!ok) {
      return reply.code(404).send({ error: "evento no encontrado o ya confirmado" });
    }
    return { acknowledged: true };
  });
}
