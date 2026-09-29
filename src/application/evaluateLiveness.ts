import type { EventRepository } from "../domain/ports/EventRepository.js";
import type {
  NodeLiveness,
  NodeStateRepository,
} from "../domain/ports/NodeStateRepository.js";
import type { StatusBroadcaster } from "../domain/ports/TelemetryBroadcaster.js";

/** Sin heartbeat en este tiempo, el nodo se da por caído (regla de
 *  dominio: los nodos laten cada 5 s, así que 15 s son tres latidos
 *  perdidos — suficiente para no marcar offline por un bache de red). */
export const OFFLINE_AFTER_MS = 15_000;

export type EvaluateLiveness = () => Promise<void>;

/** Elige qué nodo debe ser la fuente activa de una unidad: el primary si
 *  está vivo, si no el backup, y si ninguno responde, ninguno. */
function pickActive(nodes: NodeLiveness[]): NodeLiveness | null {
  const online = nodes.filter((n) => n.isOnline);
  return online.find((n) => n.role === "primary") ?? online[0] ?? null;
}

/**
 * Marca como offline a los nodos que dejaron de latir y reasigna la
 * fuente activa de su unidad. Se ejecuta periódicamente: la caída de un
 * nodo se detecta por ausencia de mensajes, y la ausencia no dispara
 * ningún evento por sí sola — hay que ir a buscarla.
 */
export function makeEvaluateLiveness(
  nodes: NodeStateRepository,
  events: EventRepository,
  broadcaster: StatusBroadcaster,
  logger: { info: (obj: object, msg: string) => void }
): EvaluateLiveness {
  return async function evaluateLiveness() {
    const limite = new Date(Date.now() - OFFLINE_AFTER_MS);
    const caidos = await nodes.findStaleOnlineNodes(limite);
    if (caidos.length === 0) return;

    // Varias caídas en la misma unidad se resuelven de una sola vez: si
    // se procesaran por separado, la primera reasignaría la fuente a un
    // nodo que la segunda va a tumbar enseguida.
    const unidadesTocadas = new Set<string>();

    for (const nodo of caidos) {
      await nodes.setOnline(nodo.id, false);
      unidadesTocadas.add(nodo.unitId);

      logger.info(
        { nodeId: nodo.nodeCode, unitId: nodo.unitCode, role: nodo.role },
        "liveness: nodo sin heartbeat, marcado offline"
      );
      broadcaster.nodeStatus({
        nodeId: nodo.nodeCode,
        unitId: nodo.unitCode,
        role: nodo.role,
        isOnline: false,
      });
    }

    for (const unitId of unidadesTocadas) {
      await reassignActive(unitId);
    }
  };

  /** Recalcula la fuente activa de una unidad y registra el cambio. */
  async function reassignActive(unitId: string): Promise<void> {
    const deLaUnidad = await nodes.findNodesOfUnit(unitId);
    if (deLaUnidad.length === 0) return;

    const actualId = deLaUnidad[0]!.activeNodeId;
    const nuevo = pickActive(deLaUnidad);
    const nuevoId = nuevo?.id ?? null;

    if (nuevoId === actualId) return;

    await nodes.setActiveNode(unitId, nuevoId);

    const unitCode = deLaUnidad[0]!.unitCode;
    const reason = nuevo === null ? "no_nodes_online" : nuevo.role === "primary" ? "recovered" : "failover";

    // El evento es de la unidad, no de un nodo: compara primary contra
    // backup, así que node_id queda NULL (ver docs/schema.md).
    await events.record({
      unitId,
      nodeId: null,
      kind: "source_failover",
      severity: nuevo === null ? "critical" : "warning",
      ts: new Date(),
    });

    logger.info(
      { unitId: unitCode, activeNode: nuevo?.nodeCode ?? null, reason },
      "liveness: cambio de fuente activa"
    );
    broadcaster.activeNode({
      unitId: unitCode,
      activeNodeId: nuevo?.nodeCode ?? null,
      reason,
    });
  }
}
