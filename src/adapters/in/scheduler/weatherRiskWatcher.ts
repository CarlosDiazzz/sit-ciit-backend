import type { FastifyBaseLogger } from "fastify";

import type { EvaluateUnitWeatherRisk } from "../../../application/evaluateUnitWeatherRisk.js";

/** Open-Meteo actualiza su pronóstico por hora, no tiene sentido consultar
 *  cada pocos segundos como liveness — 15 min es suficiente para el caso de
 *  uso y evita golpear la API sin necesidad. */
const CHECK_INTERVAL_MS = 15 * 60_000;

/** Mismo patrón que startLivenessWatcher: adaptador guiado por reloj, sin
 *  cron, que atrapa errores para no tumbar el proceso ni el ciclo. */
export function startWeatherRiskWatcher(
  evaluateUnitWeatherRisk: EvaluateUnitWeatherRisk,
  logger: FastifyBaseLogger
): NodeJS.Timeout {
  logger.info("weather-risk: vigilante iniciado (cada %d ms)", CHECK_INTERVAL_MS);

  const timer = setInterval(() => {
    void evaluateUnitWeatherRisk().catch((err) => {
      logger.error({ err }, "weather-risk: fallo evaluando el riesgo climático");
    });
  }, CHECK_INTERVAL_MS);

  timer.unref();
  return timer;
}
