import type { EventKind, EventSeverity } from "../../contract/contract.js";
import type { NodeRef } from "./TelemetryRepository.js";

/** Eventos que genera el backend, no el dispositivo.
 *
 * No viajan por MQTT ni están en el EventKind del contrato (que describe
 * lo que detecta un nodo), pero se guardan en la misma tabla `events`
 * porque para el centro de control son eventos como cualquier otro.
 */
export type BackendEventKind = "source_failover" | "sensor_disagreement";

/** Todo lo que puede aparecer en la vista de Eventos: lo que detecta un
 *  nodo (contrato) más lo que genera el backend. */
export type AnyEventKind = EventKind | BackendEventKind;

export interface BackendEvent {
  unitId: string;
  /** NULL en eventos de unidad: comparan primary contra backup, no
   *  pertenecen a un solo nodo. */
  nodeId: string | null;
  kind: BackendEventKind;
  severity: EventSeverity;
  ts: Date;
}

/**
 * Evento que sí llega por MQTT (impact/door_open/door_closed/rollover/
 * threshold_exceeded). A diferencia de BackendEvent: trae msgId (se
 * deduplica, reintentos QoS1) y nodeCode/unitCode en vez de UUID — el
 * repositorio los resuelve internamente (mismo `ensureNode` que telemetry).
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
export interface EventListItem {
  id: string;
  unitId: string;
  nodeId: string | null;
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
}

export interface EventRepository {
  /** Devuelve el id del evento guardado. */
  record(event: BackendEvent): Promise<string>;
  /** false en `inserted` si msgId ya se había procesado (reintento QoS1). */
  recordDeviceEvent(event: DeviceEventToRecord): Promise<{ inserted: boolean }>;
  listRecent(limit: number): Promise<EventListItem[]>;
  /** false si el evento no existe (404 en la ruta). */
  acknowledge(eventId: string, userId: string): Promise<boolean>;
}
