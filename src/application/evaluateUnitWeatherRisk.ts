import type { EventSeverity } from "../contract/contract.js";
import type { EventRepository } from "../domain/ports/EventRepository.js";
import type { StatusBroadcaster } from "../domain/ports/TelemetryBroadcaster.js";
import type { TelemetryRepository } from "../domain/ports/TelemetryRepository.js";
import type { UnitRepository } from "../domain/ports/UnitRepository.js";
import type { WeatherPort } from "../domain/ports/WeatherPort.js";
import type { WeatherRepository } from "../domain/ports/WeatherRepository.js";
import type { CargoCategory } from "../domain/riskThresholds.js";
import { evaluateWeatherRisk, highestSeverity } from "../domain/riskThresholds.js";

export type EvaluateUnitWeatherRisk = () => Promise<void>;

interface Logger {
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

/**
 * Por cada unidad con categoría de carga declarada y posición GPS real
 * conocida: consulta el clima real (Open-Meteo) en esa posición, lo guarda,
 * evalúa las reglas de riesgo de su categoría, y si el nivel de severidad
 * cambió respecto al último evento weather_risk registrado, guarda uno
 * nuevo y lo transmite — igual que evaluateLiveness solo registra
 * source_failover en la transición, no en cada pasada del scheduler.
 */
export function makeEvaluateUnitWeatherRisk(
  units: UnitRepository,
  telemetry: TelemetryRepository,
  weatherPort: WeatherPort,
  weatherRepo: WeatherRepository,
  events: EventRepository,
  broadcaster: StatusBroadcaster,
  logger: Logger
): EvaluateUnitWeatherRisk {
  return async function evaluateUnitWeatherRisk() {
    const unitList = await units.listAll();

    for (const unit of unitList) {
      if (!unit.cargoCategory) continue;

      const position = await telemetry.findLatestPosition(unit.id);
      if (!position) continue;

      try {
        await evaluateOne(unit.id, unit.unitCode, unit.cargoCategory, position);
      } catch (err) {
        // Una unidad que falla (ej. Open-Meteo caído) no debe impedir que
        // se evalúen las demás.
        logger.error(
          { err, unitId: unit.unitCode },
          "weather-risk: fallo evaluando la unidad"
        );
      }
    }
  };

  async function evaluateOne(
    unitId: string,
    unitCode: string,
    cargoCategory: CargoCategory,
    position: { lat: number; lon: number }
  ): Promise<void> {
    const reading = await weatherPort.fetchCurrent(position.lat, position.lon);
    await weatherRepo.save(unitId, position.lat, position.lon, reading);

    const activeRules = evaluateWeatherRisk(cargoCategory, reading);
    const severity = highestSeverity(activeRules);

    const last = await events.findLatestByKind(unitId, "weather_risk");
    const lastSeverity: EventSeverity | null = last?.severity ?? null;
    if (severity === lastSeverity) return; // sin cambio, no se registra de nuevo

    const effectiveSeverity: EventSeverity = severity ?? "info";
    const details = {
      tempC: reading.tempC,
      humidityPct: reading.humidityPct,
      precipMm: reading.precipMm,
      cargoCategory,
      cleared: severity === null,
      rules: activeRules.map((r) => ({
        id: r.id,
        message: r.message,
        source: r.source,
        isAssumption: r.isAssumption,
        severity: r.severity,
      })),
    };

    await events.record({
      unitId,
      nodeId: null,
      kind: "weather_risk",
      severity: effectiveSeverity,
      ts: new Date(),
      details,
    });

    broadcaster.event({
      unitId: unitCode,
      nodeId: null,
      kind: "weather_risk",
      severity: effectiveSeverity,
      ts: Date.now(),
    });

    logger.info(
      { unitId: unitCode, severity: effectiveSeverity, activeRules: activeRules.map((r) => r.id) },
      "weather-risk: nivel de riesgo cambió"
    );
  }
}
