import type { Pool } from "pg";
import { ManagementStore, audit } from "./management/store.js";
import { filterLegacy } from "./management/access.js";
import type { FastifyInstance } from "fastify";

import type { EventRepository } from "../../../domain/ports/EventRepository.js";
import { requireRole } from "./authGuard.js";

export function registerEventRoutes(
  app: FastifyInstance,
  events: EventRepository,
  pool: Pool,
): void {
  app.get("/events", async (request) => {
    const limit = Math.min(
      Number((request.query as { limit?: string }).limit) || 100,
      500,
    );
    const list = await filterLegacy(
      pool,
      request,
      await events.listRecent(limit),
      "events",
    );

    return list.map((e) => ({
      ...e,
      value: e.value,
      threshold: e.threshold,
      ts: e.ts.toISOString(),
      receivedAt: e.receivedAt.toISOString(),
      acknowledgedAt: e.acknowledgedAt ? e.acknowledgedAt.toISOString() : null,
    }));
  });

  app.post(
    "/events/:id/ack",
    { preHandler: requireRole("admin", "control_center", "operator") },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const ok = await events.acknowledge(id, request.authUser!.id);
      if (!ok) {
        return reply
          .code(404)
          .send({ error: "evento no encontrado o ya confirmado" });
      }
      await new ManagementStore(pool).transaction((db) =>
        audit(db, request.actor, "events", id, "acknowledge", null, {
          acknowledged_by: request.actor.id,
        }),
      );
      return { acknowledged: true };
    },
  );
}
