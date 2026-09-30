import type { CellTower, CellTowerPort, Punto } from "../domain/ports/CellTowerPort.js";
import type { CellTowerRepository } from "../domain/ports/CellTowerRepository.js";

// Puntos de respaldo reales (poblaciones conocidas sobre el corredor
// Salina Cruz–Coatzacoalcos) para cuando todavía no hay un llamador que
// mande su propia lista de puntos desde la geometría real de la ruta.
// No son telemetría ni cobertura inventada — son coordenadas públicas
// de lugares reales, solo para no dejar el endpoint sin nada que
// consultar antes de que el dashboard tenga su parte lista.
export const PUNTOS_CORREDOR_RESPALDO: Punto[] = [
  { lat: 16.1667, lon: -95.2 }, // Salina Cruz
  { lat: 16.4333, lon: -95.0167 }, // Juchitán de Zaragoza
  { lat: 16.8667, lon: -95.0333 }, // Matías Romero
  { lat: 17.9667, lon: -94.7167 }, // Jáltipan
  { lat: 18.1333, lon: -94.4167 }, // Coatzacoalcos
];

// Las antenas casi no cambian de lugar; refrescar cada 24 h alcanza de
// sobra y respeta el límite diario del free tier de OpenCelliD.
const TTL_MS = 24 * 60 * 60 * 1000;

export type GetCellTowers = (puntos?: Punto[]) => Promise<CellTower[]>;

/** Devuelve las torres cacheadas, refrescando primero contra OpenCelliD
 *  si el caché está vacío o vencido. Nunca inventa una torre: si la API
 *  falla y no hay caché previo, propaga el error en vez de devolver una
 *  lista falsa. */
export function makeGetCellTowers(
  repo: CellTowerRepository,
  port: CellTowerPort,
  logger: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void }
): GetCellTowers {
  return async function getCellTowers(puntos) {
    const ultimoFetch = await repo.lastFetchedAt();
    const vencido = !ultimoFetch || Date.now() - ultimoFetch.getTime() > TTL_MS;

    if (vencido) {
      try {
        const torres = await port.fetchNear(puntos && puntos.length > 0 ? puntos : PUNTOS_CORREDOR_RESPALDO);
        await repo.replaceAll(torres);
        logger.info({ total: torres.length }, "coverage: torres reales refrescadas desde OpenCelliD");
      } catch (err) {
        logger.error({ err }, "coverage: fallo refrescando OpenCelliD, se usa el caché anterior si existe");
        if (!ultimoFetch) throw err;
      }
    }

    return repo.findAll();
  };
}
