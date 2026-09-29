import type { EventRepository } from "../domain/ports/EventRepository.js";
import type { StatusBroadcaster } from "../domain/ports/TelemetryBroadcaster.js";
import type { ValidatedEventMessage } from "../adapters/in/mqtt/messageSchemas.js";

export type IngestEvent = (msg: ValidatedEventMessage) => Promise<{ inserted: boolean }>;

export function makeIngestEvent(
  repo: EventRepository,
  broadcaster: StatusBroadcaster
): IngestEvent {
  return async function ingestEvent(msg) {
    const result = await repo.recordDeviceEvent({
      msgId: msg.msgId,
      node: { nodeCode: msg.nodeId, unitCode: msg.unitId, role: msg.role },
      kind: msg.kind,
      severity: msg.severity,
      value: msg.value,
      threshold: msg.threshold,
      gps: msg.gps,
      ts: new Date(msg.ts),
    });

    // No reemitir duplicados (reintentos QoS1): el dashboard ya lo pintó.
    if (result.inserted) {
      broadcaster.event({
        unitId: msg.unitId,
        nodeId: msg.nodeId,
        kind: msg.kind,
        severity: msg.severity,
        value: msg.value,
        threshold: msg.threshold,
        gps: msg.gps,
        ts: msg.ts,
      });
    }

    return result;
  };
}
