import type { WeatherReading } from "../riskThresholds.js";

export interface StoredWeatherReading extends WeatherReading {
  ts: Date;
  lat: number;
  lon: number;
}

export interface WeatherRepository {
  save(unitId: string, lat: number, lon: number, reading: WeatherReading): Promise<void>;
  findLatest(unitId: string): Promise<StoredWeatherReading | null>;
  findHistory(unitId: string, from: Date, to: Date): Promise<StoredWeatherReading[]>;
}
