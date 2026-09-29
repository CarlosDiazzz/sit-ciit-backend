export interface NodeRef {
  nodeCode: string;
  unitCode: string;
  role: "primary" | "backup";
}

export interface TelemetryReading {
  msgId: string;
  node: NodeRef;
  seq: number;
  ts: Date;
  receivedAt: Date;
  accel?: { x: number; y: number; z: number };
  gyro?: { x: number; y: number; z: number };
  /** microtesla (µT), lectura cruda del magnetómetro — no un rumbo. */
  mag?: { x: number; y: number; z: number };
  lux?: number;
  pressureHpa?: number;
  gps?: { lat: number; lon: number; speedMs?: number; accuracyM?: number };
}

export interface SaveTelemetryResult {
  /** false cuando msgId ya se había procesado (mensaje duplicado, no error) */
  inserted: boolean;
}

export interface TelemetryRepository {
  save(reading: TelemetryReading): Promise<SaveTelemetryResult>;
}
