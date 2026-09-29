import type { TelemetryMessage } from "../contract/contract.js";
import type {
  SaveTelemetryResult,
  TelemetryRepository,
} from "../domain/ports/TelemetryRepository.js";

export type IngestTelemetry = (msg: TelemetryMessage) => Promise<SaveTelemetryResult>;

export function makeIngestTelemetry(repo: TelemetryRepository): IngestTelemetry {
  return async function ingestTelemetry(msg) {
    return repo.save({
      msgId: msg.msgId,
      node: { nodeCode: msg.nodeId, unitCode: msg.unitId, role: msg.role },
      seq: msg.seq,
      ts: new Date(msg.ts),
      receivedAt: new Date(),
      accel: msg.accel,
      gyro: msg.gyro,
      lux: msg.lux,
      pressureHpa: msg.pressureHpa,
      gps: msg.gps,
    });
  };
}
