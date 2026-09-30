import { z } from "zod";

import type { WeatherPort } from "../../../domain/ports/WeatherPort.js";
import type { WeatherReading } from "../../../domain/riskThresholds.js";

const openMeteoResponseSchema = z.object({
  current: z.object({
    temperature_2m: z.number(),
    relative_humidity_2m: z.number(),
    precipitation: z.number(),
  }),
});

/** Adaptador real contra Open-Meteo (sin API key, autorizada en la
 *  propuesta del proyecto, sección 7). Usa el `fetch` global de Node
 *  20+ — el repo no tiene axios/undici como dependencia y no hace falta
 *  agregar una. */
export class OpenMeteoWeatherClient implements WeatherPort {
  async fetchCurrent(lat: number, lon: number): Promise<WeatherReading> {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat.toFixed(4));
    url.searchParams.set("longitude", lon.toFixed(4));
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,precipitation");

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Open-Meteo respondió ${res.status} ${res.statusText}`);
    }

    const parsed = openMeteoResponseSchema.parse(await res.json());
    return {
      tempC: parsed.current.temperature_2m,
      humidityPct: parsed.current.relative_humidity_2m,
      precipMm: parsed.current.precipitation,
    };
  }
}
