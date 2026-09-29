export interface TelemetryBroadcastPayload {
  nodeId: string;
  unitId: string;
  role: "primary" | "backup";
  seq: number;
  ts: number;
  receivedAt: number;
  accel?: { x: number; y: number; z: number };
  gyro?: { x: number; y: number; z: number };
  lux?: number;
  pressureHpa?: number;
  gps?: { lat: number; lon: number; speedMs?: number; accuracyM?: number };
}

export interface TelemetryBroadcaster {
  broadcast(payload: TelemetryBroadcastPayload): void;
}
