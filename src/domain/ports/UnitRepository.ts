import type { CargoCategory } from "../riskThresholds.js";

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
  /** Tipo de carga que declara el cliente; null si todavía no se asignó.
   *  No es un dato de sensor — se fija desde el dashboard. */
  cargoCategory: CargoCategory | null;
  nodes: NodeState[];
}

export interface UnitRepository {
  listAll(): Promise<UnitState[]>;
  /** false si la unidad no existe (404 en la ruta). */
  setCargoCategory(unitId: string, category: CargoCategory): Promise<boolean>;
}
