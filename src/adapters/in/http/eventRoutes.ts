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

  /** Ventana de telemetria alrededor de un evento.
   *
   * Un evento guarda su pico (value) y el umbral, pero no la forma de la
   * señal: un golpe de via y un frenon pueden alcanzar el mismo maximo y
   * tener curvas completamente distintas. Sin la ventana no se puede
   * saber que paso, solo que algo supero un numero.
   *
   * No hace falta que el nodo mande nada nuevo: la telemetria ya esta en
   * la base y se reconstruye por tiempo.
   */
  app.get("/events/:id/window", async (request, reply) => {
    const { id } = request.params as { id: string };
    // Cuatro segundos a cada lado: un impacto dura decimas y un frenado
    // un par de segundos, asi que ambos caben enteros.
    const margen = Number((request.query as { seconds?: string }).seconds ?? 4);
    const segundos = Number.isFinite(margen) ? Math.min(Math.max(margen, 1), 30) : 4;

    const { rows: evRows } = await pool.query<{
      ts: Date;
      node_id: string | null;
      unit_id: string;
      kind: string;
      value: number | null;
      threshold: number | null;
    }>(
      `SELECT ts, node_id, unit_id, kind, value, threshold FROM events WHERE id = $1`,
      [id],
    );
    const ev = evRows[0];
    if (!ev) return reply.code(404).send({ error: "evento no encontrado" });

    // Un evento de unidad (failover, discrepancia) no tiene un nodo al
    // que pedirle lecturas: se devuelven las de toda la unidad.
    const { rows } = await pool.query(
      `SELECT t.ts, t.received_at, n.node_code,
              t.accel_x, t.accel_y, t.accel_z,
              t.gyro_x, t.gyro_y, t.gyro_z,
              t.gps_speed_ms
         FROM telemetry t
         JOIN nodes n ON n.id = t.node_id
        WHERE ($2::uuid IS NULL OR t.node_id = $2::uuid)
          AND ($2::uuid IS NOT NULL OR n.unit_id = $3::uuid)
          AND t.ts BETWEEN $1::timestamptz - make_interval(secs => $4)
                       AND $1::timestamptz + make_interval(secs => $4)
        ORDER BY t.ts`,
      [ev.ts, ev.node_id, ev.unit_id, segundos],
    );

    return {
      event: { id, kind: ev.kind, ts: ev.ts, value: ev.value, threshold: ev.threshold },
      windowSeconds: segundos,
      samples: rows.map((r) => ({
        ts: r.ts,
        nodeCode: r.node_code,
        // Offset respecto al evento: permite dibujar la ventana centrada
        // en el instante en que salto la alerta.
        offsetMs: new Date(r.ts).getTime() - new Date(ev.ts).getTime(),
        accel:
          r.accel_x !== null
            ? { x: r.accel_x, y: r.accel_y, z: r.accel_z }
            : null,
        gyro: r.gyro_x !== null ? { x: r.gyro_x, y: r.gyro_y, z: r.gyro_z } : null,
        speedKmh: r.gps_speed_ms !== null ? r.gps_speed_ms * 3.6 : null,
      })),
    };
  });

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
      verdict: e.verdict,
      verdictNote: e.verdictNote,
    }));
  });


  /** Veredicto del operador: si la deteccion acerto.
   *
   * Distinto de /ack, que solo marca "visto". Aqui se registra el juicio
   * de quien conoce el contexto, y cada uno es un ejemplo etiquetado
   * para afinar umbrales o entrenar un modelo mas adelante.
   */
  app.post(
    "/events/:id/verdict",
    { preHandler: requireRole("admin", "control_center", "operator") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { verdict?: string; note?: string } | undefined;
      const verdict = body?.verdict;

      if (verdict !== "confirmed" && verdict !== "false_alarm" && verdict !== "unclear") {
        return reply.code(400).send({
          error: "veredicto invalido",
          message: "Debe ser confirmed, false_alarm o unclear.",
        });
      }

      const nota = typeof body?.note === "string" && body.note.trim() !== ""
        ? body.note.trim().slice(0, 500)
        : null;

      const ok = await events.setVerdict(id, request.authUser!.id, verdict, nota);
      if (!ok) return reply.code(404).send({ error: "evento no encontrado" });

      await new ManagementStore(pool).transaction((db) =>
        audit(db, request.actor, "events", id, "verdict", null, {
          verdict,
          note: nota,
        }),
      );
      return { verdict, note: nota };
    },
  );

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
