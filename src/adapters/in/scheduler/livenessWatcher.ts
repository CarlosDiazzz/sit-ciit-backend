import type { FastifyBaseLogger } from "fastify";

import type { EvaluateLiveness } from "../../../application/evaluateLiveness.js";

/** Cada cuánto se revisa si algún nodo dejó de latir. Más fino que el
 *  umbral de 15 s para que la detección no se retrase hasta 30 s. */
const CHECK_INTERVAL_MS = 5_000;

/**
 * Adaptador de entrada guiado por reloj: la caída de un nodo no genera
 * ningún mensaje, así que alguien tiene que ir a buscarla.
 */
export function startLivenessWatcher(
  evaluateLiveness: EvaluateLiveness,
  logger: FastifyBaseLogger
): NodeJS.Timeout {
  logger.info("liveness: vigilante iniciado (cada %d ms)", CHECK_INTERVAL_MS);

  const timer = setInterval(() => {
    // Una pasada que falla no debe tumbar el proceso ni detener el ciclo.
    void evaluateLiveness().catch((err) => {
      logger.error({ err }, "liveness: fallo evaluando el estado de los nodos");
    });
  }, CHECK_INTERVAL_MS);

  // No mantener vivo el proceso solo por este temporizador.
  timer.unref();
  return timer;
}
