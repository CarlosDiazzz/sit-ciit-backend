import { z } from "zod";

import type { CellTower, CellTowerPort, Punto } from "../../../domain/ports/CellTowerPort.js";

const cellSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  radio: z.string().nullable().optional(),
  range: z.number().nullable().optional(),
  mcc: z.number().nullable().optional(),
  mnc: z.number().nullable().optional(),
  samples: z.number().nullable().optional(),
});

const responseSchema = z.object({
  count: z.number(),
  cells: z.array(cellSchema),
});

// El maximo real de la API es 50 por pagina (docs.opencellid.org/docs/
// api/cells-in-area) — se pagina con offset hasta que una pagina
// devuelva menos de 50.
const LIMITE_POR_PAGINA = 50;
const TOPE_PAGINAS_POR_CELDA = 5;

// El limite real del free tier es 4,000,000 m² por consulta ("BBOX too
// big - Limit to 4,000,000 sq.mts.", verificado en vivo) — el corredor
// completo no entra en una sola llamada. 0.008° de radio da una celda
// de ~1780 x 1780 m ≈ 3.17 millones de m² a esta latitud, con margen
// bajo el limite.
const RADIO_GRADOS = 0.008;

// Tope duro de puntos por refresh, sin importar cuantos mande el
// dashboard: protege el limite diario del free tier en un solo refresh
// (las torres casi no cambian, un refresh cada 24h que cubra la mayoria
// del corredor es suficiente).
const TOPE_PUNTOS = 80;

function bboxDePunto(p: Punto): string {
  const latMin = p.lat - RADIO_GRADOS;
  const latMax = p.lat + RADIO_GRADOS;
  const lonMin = p.lon - RADIO_GRADOS;
  const lonMax = p.lon + RADIO_GRADOS;
  return `${latMin},${lonMin},${latMax},${lonMax}`;
}

/** Si mandan mas puntos que TOPE_PUNTOS, se muestrean parejos en vez de
 *  cortar la cola — así una lista larga sigue cubriendo todo el tramo,
 *  aunque con menos densidad, en vez de solo el principio. */
function muestrear<T>(items: T[], tope: number): T[] {
  if (items.length <= tope) return items;
  const paso = items.length / tope;
  const elegidos: T[] = [];
  for (let i = 0; i < tope; i++) {
    elegidos.push(items[Math.floor(i * paso)]!);
  }
  return elegidos;
}

/** Adaptador real contra OpenCelliD ("cells in area"). Requiere
 *  OPENCELLID_API_KEY real — sin key, cada llamada falla explícito en
 *  vez de devolver datos inventados. */
export class OpenCelliDClient implements CellTowerPort {
  constructor(private readonly apiKey: string) {}

  async fetchNear(puntos: Punto[]): Promise<CellTower[]> {
    if (!this.apiKey) {
      throw new Error("OPENCELLID_API_KEY no está configurada");
    }

    const aConsultar = muestrear(puntos, TOPE_PUNTOS);
    const vistas = new Set<string>();
    const torres: CellTower[] = [];

    for (const punto of aConsultar) {
      const bbox = bboxDePunto(punto);
      for (let pagina = 0; pagina < TOPE_PAGINAS_POR_CELDA; pagina++) {
        const url = new URL("https://opencellid.org/cell/getInArea");
        url.searchParams.set("key", this.apiKey);
        url.searchParams.set("BBOX", bbox);
        url.searchParams.set("format", "json");
        url.searchParams.set("limit", String(LIMITE_POR_PAGINA));
        url.searchParams.set("offset", String(pagina * LIMITE_POR_PAGINA));

        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`OpenCelliD respondió ${res.status} ${res.statusText}`);
        }
        const parsed = responseSchema.parse(await res.json());

        for (const c of parsed.cells) {
          // Celdas vecinas se solapan a proposito (mejor cubrir de mas
          // que dejar huecos en la ruta) — se deduplica por posicion
          // real, no por venir de dos celdas distintas.
          const clave = `${c.lat.toFixed(6)},${c.lon.toFixed(6)}`;
          if (vistas.has(clave)) continue;
          vistas.add(clave);
          torres.push({
            lat: c.lat,
            lon: c.lon,
            radio: c.radio ?? null,
            rangeM: c.range ?? null,
            mcc: c.mcc ?? null,
            mnc: c.mnc ?? null,
            samples: c.samples ?? null,
          });
        }

        if (parsed.cells.length < LIMITE_POR_PAGINA) break;
      }
    }
    return torres;
  }
}
