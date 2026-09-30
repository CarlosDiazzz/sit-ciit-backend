import type { FastifyInstance } from "fastify";

import type { GetCellTowers } from "../../../application/getCellTowers.js";
import type { Punto } from "../../../domain/ports/CellTowerPort.js";

/** "lat,lon;lat,lon;..." — el dashboard manda puntos muestreados sobre
 *  la geometría real de la Línea Z que ya tiene (parseMainRailRoute en
 *  mapData.ts); el backend no duplica esa lógica de ruta, solo consulta
 *  antenas reales cerca de los puntos que le pasan. */
function parsePuntos(raw: string | undefined): Punto[] | undefined {
  if (!raw) return undefined;
  const puntos: Punto[] = [];
  for (const par of raw.split(";")) {
    const [latStr, lonStr] = par.split(",");
    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (Number.isFinite(lat) && Number.isFinite(lon)) puntos.push({ lat, lon });
  }
  return puntos.length > 0 ? puntos : undefined;
}

/** Antenas reales (OpenCelliD) cerca del corredor — capa del mapa y
 *  base para estimar hacia dónde hay cobertura conocida mientras un
 *  nodo está sin señal. */
export function registerCoverageRoutes(app: FastifyInstance, getCellTowers: GetCellTowers): void {
  app.get("/coverage/towers", async (request) => {
    const puntos = parsePuntos((request.query as { points?: string }).points);
    const torres = await getCellTowers(puntos);
    return torres.map((t) => ({
      lat: t.lat,
      lon: t.lon,
      radio: t.radio,
      rangeM: t.rangeM,
      mcc: t.mcc,
      mnc: t.mnc,
      samples: t.samples,
    }));
  });
}
