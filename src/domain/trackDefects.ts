/* Confirmación de defectos de vía por repetición.
 *
 * El problema que resuelve: un evento suelto no distingue un defecto de
 * la vía de una sacudida del vehículo. Si un nodo reporta una
 * irregularidad en un punto, pudo ser un bache real, un soporte flojo o
 * que alguien movió la caja. Lo que separa una cosa de otra es la
 * repetición: **lo que vuelve a detectarse en el mismo lugar con
 * vehículos distintos es de la vía; lo que se repite en el mismo
 * vehículo por todas partes es del vehículo.**
 *
 * Esto no necesita un modelo entrenado. Es geometría y conteo, y por eso
 * da un resultado defendible desde el primer recorrido: cada
 * confirmación se puede explicar señalando qué nodos la vieron y cuándo.
 *
 * Sobre la precisión: el GPS de un celular ronda los 95 m de error medido
 * en este proyecto, así que la tolerancia de agrupación NO puede ser fija
 * ni pequeña. Se deriva de la precisión reportada por cada lectura.
 */

export interface DeteccionGeolocalizada {
  eventId: string;
  nodeCode: string;
  unitCode: string;
  kind: string;
  lat: number;
  lon: number;
  /** Precisión del fix en metros. Sin ella se asume el peor caso. */
  accuracyM: number | null;
  value: number | null;
  ts: Date;
  /** Veredicto del operador, si lo dio. Un descarte explícito pesa. */
  verdict: "confirmed" | "false_alarm" | "unclear" | null;
}

export type NivelConfianza = "confirmado" | "probable" | "indicio";

export interface DefectoAgrupado {
  /** Centro del grupo, promediado con peso por precisión. */
  lat: number;
  lon: number;
  /** Radio que cubre las detecciones, en metros. */
  radioM: number;
  kind: string;
  detecciones: DeteccionGeolocalizada[];
  /** Nodos distintos que lo vieron: la clave de la confirmación. */
  nodosDistintos: number;
  /** Unidades distintas: dos nodos del mismo camión no son
   *  observaciones independientes, van juntos. */
  unidadesDistintas: number;
  /** Cuántas veces se pasó por ahí detectando algo. */
  pasadas: number;
  severidadMedia: number | null;
  confianza: NivelConfianza;
  /** Por qué se le asignó ese nivel, en una frase. */
  motivo: string;
  primeraVez: Date;
  ultimaVez: Date;
}

/** Sin precisión reportada se asume este error, deliberadamente
 *  pesimista: agrupar de más es preferible a partir un defecto real en
 *  dos grupos que nunca llegan a confirmarse. */
const PRECISION_ASUMIDA_M = 100;

/** Tolerancia mínima aunque el GPS diga ser muy preciso: el tren avanza
 *  entre la detección y el fix, y un defecto de vía tiene extensión. */
const TOLERANCIA_MINIMA_M = 25;

/** Tope de la tolerancia. Por encima se agruparían defectos que están
 *  claramente separados a lo largo de la vía. */
const TOLERANCIA_MAXIMA_M = 250;

/** Distancia entre dos puntos, en metros. A escala de un corredor
 *  tratar los grados como plano es suficiente y evita el coste de
 *  haversine en cada comparación. */
export function distanciaM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLon = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/** Radio de búsqueda para una detección: su propia incertidumbre,
 *  acotada por arriba y por abajo. */
function tolerancia(d: DeteccionGeolocalizada): number {
  const precision = d.accuracyM ?? PRECISION_ASUMIDA_M;
  return Math.min(TOLERANCIA_MAXIMA_M, Math.max(TOLERANCIA_MINIMA_M, precision));
}

/**
 * Agrupa detecciones cercanas del mismo tipo.
 *
 * Es un agrupamiento por densidad, en la línea de DBSCAN pero con el
 * radio derivado de la precisión de cada punto en vez de fijo: una
 * lectura con 200 m de error no puede exigir la misma cercanía que una
 * con 10 m.
 *
 * Solo se agrupan detecciones del MISMO tipo: una irregularidad de vía y
 * un frenado brusco en el mismo punto son dos hechos distintos, aunque
 * el segundo pueda ser consecuencia del primero.
 */
export function agruparDetecciones(
  detecciones: DeteccionGeolocalizada[],
): DeteccionGeolocalizada[][] {
  const pendientes = [...detecciones];
  const grupos: DeteccionGeolocalizada[][] = [];

  while (pendientes.length > 0) {
    const semilla = pendientes.shift()!;
    const grupo = [semilla];

    // Crecimiento por vecindad: una detección entra si está dentro de la
    // tolerancia de CUALQUIER miembro del grupo, no solo de la semilla.
    // Así un defecto extendido a lo largo de la vía no se parte en dos.
    let creció = true;
    while (creció) {
      creció = false;
      for (let i = pendientes.length - 1; i >= 0; i -= 1) {
        const cand = pendientes[i]!;
        if (cand.kind !== semilla.kind) continue;

        const cerca = grupo.some(
          (m) => distanciaM(m, cand) <= Math.max(tolerancia(m), tolerancia(cand)),
        );
        if (cerca) {
          grupo.push(cand);
          pendientes.splice(i, 1);
          creció = true;
        }
      }
    }

    grupos.push(grupo);
  }

  return grupos;
}

/**
 * Decide cuánta confianza merece un grupo.
 *
 * El criterio central es la independencia de las observaciones: dos
 * nodos del mismo camión ven el mismo bache a la vez, así que cuentan
 * como una sola pasada. Lo que confirma un defecto es que **unidades
 * distintas**, en momentos distintos, detecten lo mismo en el mismo
 * lugar.
 */
export function evaluarConfianza(grupo: DeteccionGeolocalizada[]): {
  confianza: NivelConfianza;
  motivo: string;
} {
  const unidades = new Set(grupo.map((d) => d.unitCode));
  const nodos = new Set(grupo.map((d) => d.nodeCode));
  const descartados = grupo.filter((d) => d.verdict === "false_alarm").length;
  const confirmados = grupo.filter((d) => d.verdict === "confirmed").length;

  // Un operador que descartó la mayoría sabe algo que el algoritmo no.
  // Su juicio manda sobre el conteo.
  if (descartados > grupo.length / 2) {
    return {
      confianza: "indicio",
      motivo: `El operador descartó ${descartados} de ${grupo.length} detecciones aquí.`,
    };
  }

  if (unidades.size >= 3) {
    return {
      confianza: "confirmado",
      motivo: `${unidades.size} unidades distintas detectaron lo mismo en este punto.`,
    };
  }

  if (unidades.size === 2) {
    return {
      confianza: confirmados > 0 ? "confirmado" : "probable",
      motivo:
        confirmados > 0
          ? `Dos unidades lo detectaron y el operador confirmó ${confirmados}.`
          : "Dos unidades distintas lo detectaron; falta una tercera para confirmarlo.",
    };
  }

  // Una sola unidad: puede ser la vía o puede ser ese vehículo. Varias
  // pasadas separadas en el tiempo lo hacen más probable, pero no lo
  // confirman — es justo la confusión que este análisis debe evitar.
  const pasadas = contarPasadas(grupo);
  if (pasadas >= 3) {
    return {
      confianza: "probable",
      motivo: `Una sola unidad, pero lo detectó en ${pasadas} pasadas distintas. Hace falta otra unidad para descartar que sea del vehículo.`,
    };
  }

  return {
    confianza: "indicio",
    motivo:
      nodos.size > 1
        ? "Detectado por dos nodos del mismo vehículo, que no son observaciones independientes."
        : "Una sola detección: puede ser de la vía o del vehículo.",
  };
}

/** Separación temporal mínima para contar dos detecciones como pasadas
 *  distintas. Por debajo, el tren sigue sobre el mismo defecto. */
const SEPARACION_PASADA_MS = 10 * 60 * 1000;

/** Cuántas veces se pasó por el punto, no cuántas detecciones hubo: un
 *  tren largo sobre un bache genera varias en segundos. */
export function contarPasadas(grupo: DeteccionGeolocalizada[]): number {
  const porUnidad = new Map<string, Date[]>();
  for (const d of grupo) {
    const lista = porUnidad.get(d.unitCode);
    if (lista) lista.push(d.ts);
    else porUnidad.set(d.unitCode, [d.ts]);
  }

  let total = 0;
  for (const tiempos of porUnidad.values()) {
    tiempos.sort((a, b) => a.getTime() - b.getTime());
    let pasadas = 1;
    for (let i = 1; i < tiempos.length; i += 1) {
      if (tiempos[i]!.getTime() - tiempos[i - 1]!.getTime() > SEPARACION_PASADA_MS) {
        pasadas += 1;
      }
    }
    total += pasadas;
  }
  return total;
}

/** Centro del grupo, ponderando cada punto por su precisión: una lectura
 *  de 10 m debe pesar más que una de 200 m al decidir dónde está el
 *  defecto. */
function centroPonderado(grupo: DeteccionGeolocalizada[]): { lat: number; lon: number } {
  let sumaPeso = 0;
  let lat = 0;
  let lon = 0;
  for (const d of grupo) {
    // Peso inverso al error: menos error, más voz.
    const peso = 1 / Math.max(10, d.accuracyM ?? PRECISION_ASUMIDA_M);
    lat += d.lat * peso;
    lon += d.lon * peso;
    sumaPeso += peso;
  }
  return sumaPeso === 0
    ? { lat: grupo[0]!.lat, lon: grupo[0]!.lon }
    : { lat: lat / sumaPeso, lon: lon / sumaPeso };
}

/** Análisis completo: de detecciones sueltas a defectos con su nivel de
 *  confianza, ordenados por lo que más merece una inspección. */
export function analizarDefectos(
  detecciones: DeteccionGeolocalizada[],
): DefectoAgrupado[] {
  const conGps = detecciones.filter(
    (d) => Number.isFinite(d.lat) && Number.isFinite(d.lon),
  );

  return agruparDetecciones(conGps)
    .map((grupo): DefectoAgrupado => {
      const centro = centroPonderado(grupo);
      const radio = grupo.reduce((max, d) => Math.max(max, distanciaM(centro, d)), 0);
      const valores = grupo.map((d) => d.value).filter((v): v is number => v !== null);
      const tiempos = grupo.map((d) => d.ts.getTime());
      const { confianza, motivo } = evaluarConfianza(grupo);

      return {
        ...centro,
        radioM: Math.round(radio),
        kind: grupo[0]!.kind,
        detecciones: grupo,
        nodosDistintos: new Set(grupo.map((d) => d.nodeCode)).size,
        unidadesDistintas: new Set(grupo.map((d) => d.unitCode)).size,
        pasadas: contarPasadas(grupo),
        severidadMedia:
          valores.length > 0 ? valores.reduce((a, b) => a + b, 0) / valores.length : null,
        confianza,
        motivo,
        primeraVez: new Date(Math.min(...tiempos)),
        ultimaVez: new Date(Math.max(...tiempos)),
      };
    })
    .sort((a, b) => {
      // Primero lo confirmado, luego lo más severo: es el orden en que
      // conviene mandar una cuadrilla.
      const peso = { confirmado: 0, probable: 1, indicio: 2 };
      return (
        peso[a.confianza] - peso[b.confianza] ||
        (b.severidadMedia ?? 0) - (a.severidadMedia ?? 0) ||
        b.pasadas - a.pasadas
      );
    });
}
