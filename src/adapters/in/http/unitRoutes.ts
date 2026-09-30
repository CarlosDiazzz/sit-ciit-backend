import type { Pool } from "pg";
import { ManagementStore, audit } from "./management/store.js";
import { filterLegacy } from "./management/access.js";
import { requireRole } from "./authGuard.js";
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
export function registerUnitRoutes(
  app: FastifyInstance,
  units: UnitRepository,
  pool: Pool,
): void {
  app.get("/units", async (request) => {
    const list = await filterLegacy(
      pool,
      request,
      await units.listAll(),
      "units",
    );

    // Las fechas se serializan como ISO 8601 para que el dashboard no
    // tenga que adivinar el formato (el resto de la API hace lo mismo).
    return list.map((u) => ({
      ...u,
      nodes: u.nodes.map((n) => ({
        ...n,
        lastHeartbeatAt: n.lastHeartbeatAt
          ? n.lastHeartbeatAt.toISOString()
          : null,
      })),
    }));
  });

  // Sin auth en el backend todavía (Fase 6, ver CORS en index.ts): el
  // dashboard oculta este control a quien no sea control_center, pero la
  // ruta en sí no valida rol porque no hay de dónde sacarlo todavía.
  app.patch(
    "/units/:id/cargo-category",
    { preHandler: requireRole("admin", "control_center") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = cargoCategoryBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "body inválido", issues: parsed.error.issues });
      }

      const previous = await pool.query(
        "SELECT cargo_category FROM units WHERE id=$1",
        [id],
      );
      const ok = await units.setCargoCategory(id, parsed.data.category);
      if (!ok) {
        return reply.code(404).send({ error: "unidad no encontrada" });
      }
      await new ManagementStore(pool).transaction((db) =>
        audit(
          db,
          request.actor,
          "units",
          id,
          "update",
          previous.rows[0] ?? null,
          { cargo_category: parsed.data.category },
        ),
      );
      return { cargoCategory: parsed.data.category };
    },
  );
}
