import type { Pool } from "pg";

import type {
  StoredWeatherReading,
  WeatherRepository,
} from "../../../domain/ports/WeatherRepository.js";
import type { WeatherReading } from "../../../domain/riskThresholds.js";

interface WeatherRow {
  ts: Date;
  lat: string;
  lon: string;
  temp_c: string | null;
  humidity_pct: string | null;
  precip_mm: string | null;
}

function toReading(r: WeatherRow): StoredWeatherReading {
  return {
    ts: r.ts,
    lat: Number(r.lat),
    lon: Number(r.lon),
    tempC: Number(r.temp_c),
    humidityPct: Number(r.humidity_pct),
    precipMm: Number(r.precip_mm),
  };
}

export class PgWeatherRepository implements WeatherRepository {
  constructor(private readonly pool: Pool) {}

  async save(unitId: string, lat: number, lon: number, reading: WeatherReading): Promise<void> {
    await this.pool.query(
      `INSERT INTO weather_readings (unit_id, lat, lon, temp_c, humidity_pct, precip_mm)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [unitId, lat, lon, reading.tempC, reading.humidityPct, reading.precipMm]
    );
  }

  async findLatest(unitId: string): Promise<StoredWeatherReading | null> {
    const { rows } = await this.pool.query<WeatherRow>(
      `SELECT ts, lat, lon, temp_c, humidity_pct, precip_mm
         FROM weather_readings
        WHERE unit_id = $1
        ORDER BY ts DESC
        LIMIT 1`,
      [unitId]
    );
    const row = rows[0];
    return row ? toReading(row) : null;
  }

  async findHistory(unitId: string, from: Date, to: Date): Promise<StoredWeatherReading[]> {
    const { rows } = await this.pool.query<WeatherRow>(
      `SELECT ts, lat, lon, temp_c, humidity_pct, precip_mm
         FROM weather_readings
        WHERE unit_id = $1 AND ts >= $2 AND ts <= $3
        ORDER BY ts ASC`,
      [unitId, from, to]
    );
    return rows.map(toReading);
  }
}
