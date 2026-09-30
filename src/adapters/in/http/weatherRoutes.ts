import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { evaluateWeatherRisk, RISK_RULES } from "../../../domain/riskThresholds.js";
import type { UnitRepository } from "../../../domain/ports/UnitRepository.js";
import type { WeatherRepository } from "../../../domain/ports/WeatherRepository.js";

const historyQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

/** Clima real (Open-Meteo) en la última posición conocida de una unidad, y
 *  las reglas de riesgo activas para su categoría de carga declarada — no
 *  "cumple/no cumple norma", ver domain/riskThresholds.ts. */
export function registerWeatherRoutes(
  app: FastifyInstance,
  units: UnitRepository,
  weather: WeatherRepository
): void {
  // Tabla de referencia: todas las reglas (activas o no), con su umbral
  // declarado y su fuente — para que el dashboard pueda mostrar "bajo qué
  // valor y qué norma" se evalúa cada categoría, no solo las que ya
  // dispararon. Es dato estático del dominio, no depende de una unidad.
  app.get("/risk-rules", async () => RISK_RULES);

  app.get("/units/:id/weather/latest", async (request, reply) => {
    const { id } = request.params as { id: string };

    const unitList = await units.listAll();
    const unit = unitList.find((u) => u.id === id);
    if (!unit) {
      return reply.code(404).send({ error: "unidad no encontrada" });
    }

    const reading = await weather.findLatest(id);
    if (!reading) {
      return reply.code(404).send({ error: "todavía no hay una lectura de clima para esta unidad" });
    }

    const activeRules = unit.cargoCategory ? evaluateWeatherRisk(unit.cargoCategory, reading) : [];

    return {
      cargoCategory: unit.cargoCategory,
      weather: {
        ts: reading.ts.toISOString(),
        lat: reading.lat,
        lon: reading.lon,
        tempC: reading.tempC,
        humidityPct: reading.humidityPct,
        precipMm: reading.precipMm,
      },
      activeRules,
    };
  });

  app.get("/units/:id/weather/history", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = historyQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "query inválida", issues: parsed.error.issues });
    }

    const history = await weather.findHistory(id, new Date(parsed.data.from), new Date(parsed.data.to));
    return history.map((r) => ({ ...r, ts: r.ts.toISOString() }));
  });
}
