/** Nodo con su estado actual, tal como lo necesita el dashboard para
 *  mostrar varias unidades con su primary y su backup. */
export interface NodeState {
  id: string;
  nodeCode: string;
  unitId: string;
  role: "primary" | "backup";
  isOnline: boolean;
  lastHeartbeatAt: Date | null;
  batteryPct: number | null;
  pendingOutbox: number | null;
  samplingMs: number | null;
  mode: "normal" | "inspection" | "alarm" | null;
  capabilities: string[];
}

export interface UnitState {
  id: string;
  unitCode: string;
  label: string | null;
  /** Nodo que la unidad está usando ahora; null si ninguno está online. */
  activeNodeId: string | null;
  nodes: NodeState[];
}

export interface UnitRepository {
  listAll(): Promise<UnitState[]>;
}
