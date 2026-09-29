import type { FastifyInstance } from "fastify";

import type { UnitRepository } from "../../../domain/ports/UnitRepository.js";

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
}
