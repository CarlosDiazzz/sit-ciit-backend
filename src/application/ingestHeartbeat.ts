import type { EventRepository } from "../domain/ports/EventRepository.js";
import type { NodeStateRepository } from "../domain/ports/NodeStateRepository.js";
import type { StatusBroadcaster } from "../domain/ports/TelemetryBroadcaster.js";
import type { ValidatedHeartbeatMessage } from "../adapters/in/mqtt/messageSchemas.js";

export type IngestHeartbeat = (msg: ValidatedHeartbeatMessage) => Promise<void>;

/**
 * Guarda el estado que reporta el nodo y, si estaba dado por caído,
 * gestiona su regreso: un primary que vuelve recupera la fuente activa
 * de su unidad (regla de dominio) y eso se registra igual que la caída.
 */
export function makeIngestHeartbeat(
  nodes: NodeStateRepository,
  events: EventRepository,
  broadcaster: StatusBroadcaster,
  logger: { info: (obj: object, msg: string) => void }
): IngestHeartbeat {
  return async function ingestHeartbeat(msg) {
    // Se consulta el estado anterior antes de escribir, para saber si
    // esto es un regreso o un latido más de un nodo que ya estaba vivo.
    const antes = await nodes.findByNodeCode(msg.nodeId);
    const estabaOffline = antes !== null && !antes.isOnline;

    await nodes.applyHeartbeat({
      node: { nodeCode: msg.nodeId, unitCode: msg.unitId, role: msg.role },
      msgId: msg.msgId,
      ts: new Date(msg.ts),
      receivedAt: new Date(),
      batteryPct: msg.batteryPct,
      pendingOutbox: msg.pendingOutbox,
      samplingMs: msg.samplingMs,
      capabilities: msg.capabilities,
      mode: msg.mode,
    });

    if (!estabaOffline) return;

    logger.info({ nodeId: msg.nodeId, unitId: msg.unitId }, "liveness: nodo de vuelta");
    broadcaster.nodeStatus({
      nodeId: msg.nodeId,
      unitId: msg.unitId,
      role: msg.role,
      isOnline: true,
    });

    await reassignActive(antes.unitId, msg.unitId);
  };

  async function reassignActive(unitId: string, unitCode: string): Promise<void> {
    const deLaUnidad = await nodes.findNodesOfUnit(unitId);
    if (deLaUnidad.length === 0) return;

    const actualId = deLaUnidad[0]!.activeNodeId;
    const online = deLaUnidad.filter((n) => n.isOnline);
    const nuevo = online.find((n) => n.role === "primary") ?? online[0] ?? null;
    const nuevoId = nuevo?.id ?? null;

    if (nuevoId === actualId) return;

    await nodes.setActiveNode(unitId, nuevoId);
    await events.record({
      unitId,
      nodeId: null,
      kind: "source_failover",
      severity: "info",
      ts: new Date(),
    });

    logger.info(
      { unitId: unitCode, activeNode: nuevo?.nodeCode ?? null },
      "liveness: fuente activa restituida"
    );
    broadcaster.activeNode({
      unitId: unitCode,
      activeNodeId: nuevo?.nodeCode ?? null,
      reason: "recovered",
    });
  }
}
