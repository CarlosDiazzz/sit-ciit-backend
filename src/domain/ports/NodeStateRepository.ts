import type { NodeRef } from "./TelemetryRepository.js";

/** Estado que reporta un nodo en cada heartbeat. */
export interface HeartbeatState {
  node: NodeRef;
  msgId: string;
  ts: Date;
  receivedAt: Date;
  batteryPct?: number;
  pendingOutbox: number;
  samplingMs: number;
  capabilities: string[];
  mode: "normal" | "inspection" | "alarm";
}

/** Nodo tal como lo necesita la evaluación de failover. */
export interface NodeLiveness {
  id: string;
  nodeCode: string;
  unitId: string;
  unitCode: string;
  role: "primary" | "backup";
  isOnline: boolean;
  lastHeartbeatAt: Date | null;
  /** Nodo que la unidad tiene marcado como fuente activa. */
  activeNodeId: string | null;
}

export interface NodeStateRepository {
  /** Guarda el estado del heartbeat y marca el nodo online. */
  applyHeartbeat(state: HeartbeatState): Promise<void>;

  /** Nodos cuyo último heartbeat es más viejo que el umbral y siguen
   *  marcados como online: son los que hay que dar por caídos. */
  findStaleOnlineNodes(olderThan: Date): Promise<NodeLiveness[]>;

  /** Todos los nodos de una unidad, para decidir quién toma el relevo. */
  findNodesOfUnit(unitId: string): Promise<NodeLiveness[]>;

  /** Un nodo por su código del contrato ("unit-01-a"), o null si aún no
   *  está dado de alta. */
  findByNodeCode(nodeCode: string): Promise<NodeLiveness | null>;

  setOnline(nodeId: string, isOnline: boolean): Promise<void>;

  /** Cambia la fuente activa de la unidad (o la deja sin ninguna). */
  setActiveNode(unitId: string, nodeId: string | null): Promise<void>;
}
