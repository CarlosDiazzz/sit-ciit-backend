export interface TelemetryBroadcastPayload {
  nodeId: string;
  unitId: string;
  role: "primary" | "backup";
  seq: number;
  ts: number;
  receivedAt: number;
  accel?: { x: number; y: number; z: number };
  gyro?: { x: number; y: number; z: number };
  /** microtesla (µT), lectura cruda del magnetómetro — no un rumbo. */
  mag?: { x: number; y: number; z: number };
  lux?: number;
  pressureHpa?: number;
  gps?: { lat: number; lon: number; speedMs?: number; accuracyM?: number };
}

export interface TelemetryBroadcaster {
  broadcast(payload: TelemetryBroadcastPayload): void;
}

/** Cambio de estado de un nodo (se cayó o volvió). */
export interface NodeStatusPayload {
  nodeId: string;
  unitId: string;
  role: "primary" | "backup";
  isOnline: boolean;
}

/** La unidad cambió de fuente activa. */
export interface ActiveNodePayload {
  unitId: string;
  /** Código del nodo que pasa a ser la fuente; null si ninguno está vivo. */
  activeNodeId: string | null;
  reason: "failover" | "recovered" | "no_nodes_online";
}

/** Evento detectado en el borde (impact/door/rollover/threshold_exceeded),
 *  ya guardado — se reemite para que el dashboard lo muestre sin recargar. */
export interface EventPayload {
  unitId: string;
  nodeId: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  value?: number;
  threshold?: number;
  gps?: { lat: number; lon: number };
  ts: number;
}

/** Avisos en vivo hacia el dashboard que no son telemetría. */
export interface StatusBroadcaster {
  nodeStatus(payload: NodeStatusPayload): void;
  activeNode(payload: ActiveNodePayload): void;
  event(payload: EventPayload): void;
}
