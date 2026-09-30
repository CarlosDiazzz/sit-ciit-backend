import type { EventKind, EventSeverity } from "../../contract/contract.js";
import type { NodeRef } from "./TelemetryRepository.js";

/** Eventos que genera el backend, no el dispositivo.
 *
 * No viajan por MQTT ni están en el EventKind del contrato (que describe
 * lo que detecta un nodo), pero se guardan en la misma tabla `events`
 * porque para el centro de control son eventos como cualquier otro.
 */
export type BackendEventKind = "source_failover" | "sensor_disagreement" | "weather_risk" | "signal_lost" | "signal_recovered";

/** Todo lo que puede aparecer en la vista de Eventos: lo que detecta un
 *  nodo (contrato) más lo que genera el backend. */
export type AnyEventKind = EventKind | BackendEventKind;

export interface BackendEvent {
  unitId: string;
  /** NULL en eventos de unidad: comparan primary contra backup, no
   *  pertenecen a un solo nodo (o, en weather_risk, no aplica un nodo). */
  nodeId: string | null;
  kind: BackendEventKind;
  severity: EventSeverity;
  ts: Date;
  /** Detalle estructurado que no cabe en un solo value/threshold — hoy
   *  solo lo usa weather_risk (temperatura, humedad, lluvia y qué reglas
   *  dispararon), pero queda genérico por si otro evento de backend lo
   *  necesita después. */
  details?: Record<string, unknown>;
  /** Última posición GPS real conocida — hoy solo la usa signal_lost
   *  (dónde estaba el nodo cuando dejó de latir). source_failover y
   *  sensor_disagreement no la necesitan. */
  gps?: { lat: number; lon: number };
}

/**
 * Evento que sí llega por MQTT (impact/door_open/door_closed/rollover/
 * threshold_exceeded). A diferencia de BackendEvent: trae msgId (se
 * deduplica, reintentos QoS1) y nodeCode/unitCode en vez de UUID — el
 * repositorio los resuelve internamente (mismo `findNodeId` que telemetry).
 */
export interface DeviceEventToRecord {
  msgId: string;
  node: NodeRef;
  kind: EventKind;
  severity: EventSeverity;
  value?: number;
  threshold?: number;
  gps?: { lat: number; lon: number };
  ts: Date;
}

/** Fila tal cual se le devuelve al dashboard por REST — unitId/nodeId son
 *  UUID aquí (a diferencia del payload de socket, que usa los códigos del
 *  contrato), igual que ya hace GET /units con activeNodeId. */
/** Si la deteccion acerto, segun quien conoce el contexto. */
export type EventVerdict = "confirmed" | "false_alarm" | "unclear";

export interface EventListItem {
  id: string;
  unitId: string;
  nodeId: string | null;
  /** Codigo del contrato ("unit-01"): lo que el operador reconoce. Los
   *  UUID de arriba siguen ahi porque la vista agrupa por ellos. */
  unitCode?: string | null;
  /** Codigo del nodo ("unit-01-a"). NULL en eventos de unidad, que
   *  comparan primary contra backup. */
  nodeCode?: string | null;
  kind: AnyEventKind;
  severity: EventSeverity;
  value: number | null;
  threshold: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
  ts: Date;
  receivedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  /** Juicio del operador sobre si la deteccion acerto. NULL mientras
   *  nadie lo haya dicho: no se infiere una etiqueta que no se dio. */
  verdict: EventVerdict | null;
  verdictNote: string | null;
  details: Record<string, unknown> | null;
}

export interface EventRepository {
  /** Devuelve el id del evento guardado. */
  record(event: BackendEvent): Promise<string>;
  /** Último evento de este tipo registrado para la unidad, o null si nunca
   *  hubo uno. Se usa para detectar transiciones (ej. de "sin riesgo" a
   *  "warning") sin depender de una variable en memoria que se perdería al
   *  reiniciar el proceso — mismo principio que evaluateLiveness siempre
   *  lee el estado persistido. */
  findLatestByKind(unitId: string, kind: BackendEventKind): Promise<EventListItem | null>;
  /** false en `inserted` si msgId ya se había procesado (reintento QoS1). */
  recordDeviceEvent(event: DeviceEventToRecord): Promise<{ inserted: boolean }>;
  listRecent(limit: number): Promise<EventListItem[]>;
  /** false si el evento no existe (404 en la ruta). */
  acknowledge(eventId: string, userId: string): Promise<boolean>;

  /** Registra el veredicto. Puede corregirse: un operador que se
   *  equivoca debe poder rectificar sin dejar un dato falso. */
  setVerdict(
    eventId: string,
    userId: string,
    verdict: EventVerdict,
    note: string | null,
  ): Promise<boolean>;
}
