import type { TelemetryMessage } from "../contract/contract.js";
import type {
  SaveTelemetryResult,
  TelemetryRepository,
} from "../domain/ports/TelemetryRepository.js";
import type { TelemetryBroadcaster } from "../domain/ports/TelemetryBroadcaster.js";

export type IngestTelemetry = (msg: TelemetryMessage) => Promise<SaveTelemetryResult>;

export function makeIngestTelemetry(
  repo: TelemetryRepository,
  broadcaster: TelemetryBroadcaster
): IngestTelemetry {
  return async function ingestTelemetry(msg) {
    const receivedAt = new Date();
    const result = await repo.save({
      msgId: msg.msgId,
      node: { nodeCode: msg.nodeId, unitCode: msg.unitId, role: msg.role },
      seq: msg.seq,
      ts: new Date(msg.ts),
      receivedAt,
      accel: msg.accel,
      gyro: msg.gyro,
      lux: msg.lux,
      pressureHpa: msg.pressureHpa,
      gps: msg.gps,
    });

    // No reemitir duplicados (reintentos QoS1): el dashboard ya lo pintó.
    if (result.inserted) {
      broadcaster.broadcast({
        nodeId: msg.nodeId,
        unitId: msg.unitId,
        role: msg.role,
        seq: msg.seq,
        ts: msg.ts,
        receivedAt: receivedAt.getTime(),
        accel: msg.accel,
        gyro: msg.gyro,
        lux: msg.lux,
        pressureHpa: msg.pressureHpa,
        gps: msg.gps,
      });
    }

    return result;
  };
}
