import type { CellTower } from "./CellTowerPort.js";

export interface CellTowerRepository {
  /** Reemplaza todo el caché — es una foto del área, no un historial. */
  replaceAll(towers: CellTower[]): Promise<void>;
  findAll(): Promise<CellTower[]>;
  /** null si el caché nunca se llenó. */
  lastFetchedAt(): Promise<Date | null>;
}
