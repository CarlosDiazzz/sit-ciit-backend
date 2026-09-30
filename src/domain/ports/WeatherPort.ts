import type { WeatherReading } from "../riskThresholds.js";

/** Fuente externa de clima real (Open-Meteo — ver propuesta, sección 7:
 *  "sin API key"). Puerto separado del de persistencia: uno habla con el
 *  mundo exterior, el otro con la base de datos. */
export interface WeatherPort {
  fetchCurrent(lat: number, lon: number): Promise<WeatherReading>;
}
