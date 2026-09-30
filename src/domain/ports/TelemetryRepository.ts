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

export interface UnitPosition {
  lat: number;
  lon: number;
  /** Velocidad real del GPS en ese fix — null si el dispositivo no la
   *  reportó ese ciclo. La usa la estimación de posición mientras un
   *  nodo está sin señal (ver evaluateLiveness). */
  speedMs: number | null;
}

export interface TelemetryRepository {
  save(reading: TelemetryReading): Promise<SaveTelemetryResult>;
  /** Última posición GPS real conocida de la unidad (de cualquiera de sus
   *  nodos), o null si todavía no llegó ninguna con GPS. Es lo único que
   *  tenemos para saber "dónde está" la unidad — no hay columna de
   *  posición cacheada en `units`. */
  findLatestPosition(unitId: string): Promise<UnitPosition | null>;
  /** Última posición GPS real conocida de ESTE nodo en particular (no de
   *  su unidad, que podría traer la del nodo hermano) — para saber dónde
   *  estaba exactamente cuando dejó de latir (evaluateLiveness). */
  findLatestPositionForNode(nodeId: string): Promise<UnitPosition | null>;
}
