import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { UnitRepository } from "../../../domain/ports/UnitRepository.js";

const cargoCategoryBodySchema = z.object({
  category: z.enum(["agricola", "construccion", "quimico", "sin_carga"]),
});

/** Unidades con sus nodos y el estado actual de cada uno. Es lo que el
 *  dashboard consulta al cargar para poder mostrar varias unidades a la
 *  vez (primary y backup de cada una), antes de que empiece a llegar
 *  telemetría en vivo por Socket.IO. */
export function registerUnitRoutes(app: FastifyInstance, units: UnitRepository): void {
  app.get("/units", async () => {
    const list = await units.listAll();

    // Las fechas se serializan como ISO 8601 para que el dashboard no
    // tenga que adivinar el formato (el resto de la API hace lo mismo).
    return list.map((u) => ({
      ...u,
      nodes: u.nodes.map((n) => ({
        ...n,
        lastHeartbeatAt: n.lastHeartbeatAt ? n.lastHeartbeatAt.toISOString() : null,
      })),
    }));
  });

  // Sin auth en el backend todavía (Fase 6, ver CORS en index.ts): el
  // dashboard oculta este control a quien no sea control_center, pero la
  // ruta en sí no valida rol porque no hay de dónde sacarlo todavía.
  app.patch("/units/:id/cargo-category", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = cargoCategoryBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "body inválido", issues: parsed.error.issues });
    }

    const ok = await units.setCargoCategory(id, parsed.data.category);
    if (!ok) {
      return reply.code(404).send({ error: "unidad no encontrada" });
    }
    return { cargoCategory: parsed.data.category };
  });
}
