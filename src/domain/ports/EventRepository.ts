/** Eventos que genera el backend, no el dispositivo.
 *
 * No viajan por MQTT ni están en el EventKind del contrato (que describe
 * lo que detecta un nodo), pero se guardan en la misma tabla `events`
 * porque para el centro de control son eventos como cualquier otro.
 */
export type BackendEventKind = "source_failover" | "sensor_disagreement";

export interface BackendEvent {
  unitId: string;
  /** NULL en eventos de unidad: comparan primary contra backup, no
   *  pertenecen a un solo nodo. */
  nodeId: string | null;
  kind: BackendEventKind;
  severity: "info" | "warning" | "critical";
  ts: Date;
}

export interface EventRepository {
  /** Devuelve el id del evento guardado. */
  record(event: BackendEvent): Promise<string>;
}
