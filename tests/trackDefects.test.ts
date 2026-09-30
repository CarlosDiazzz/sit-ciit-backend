import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  agruparDetecciones,
  analizarDefectos,
  contarPasadas,
  distanciaM,
  evaluarConfianza,
  type DeteccionGeolocalizada,
} from "../src/domain/trackDefects.js";

/** Punto base sobre la Línea Z, cerca de Matías Romero. */
const BASE = { lat: 16.878, lon: -95.043 };

/** Desplaza un punto N metros al norte, para construir casos con
 *  distancias exactas en vez de coordenadas a ojo. */
function alNorte(metros: number): { lat: number; lon: number } {
  return { lat: BASE.lat + metros / 111_320, lon: BASE.lon };
}

let contador = 0;
function deteccion(
  over: Partial<DeteccionGeolocalizada> = {},
): DeteccionGeolocalizada {
  contador += 1;
  return {
    eventId: `ev-${contador}`,
    nodeCode: "unit-01-a",
    unitCode: "unit-01",
    kind: "track_irregularity",
    lat: BASE.lat,
    lon: BASE.lon,
    accuracyM: 30,
    value: 0.2,
    ts: new Date("2026-09-30T10:00:00Z"),
    verdict: null,
    ...over,
  };
}

describe("distancia", () => {
  it("mide en metros a escala del corredor", () => {
    const d = distanciaM(BASE, alNorte(100));
    assert.ok(Math.abs(d - 100) < 1, `esperaba ~100 m, dio ${d}`);
  });
});

describe("agrupación", () => {
  it("junta detecciones dentro de la precisión del GPS", () => {
    const grupos = agruparDetecciones([
      deteccion(),
      deteccion({ ...alNorte(20), nodeCode: "unit-02-a", unitCode: "unit-02" }),
    ]);
    assert.equal(grupos.length, 1);
  });

  it("separa detecciones claramente distantes", () => {
    const grupos = agruparDetecciones([
      deteccion(),
      deteccion({ ...alNorte(800), nodeCode: "unit-02-a", unitCode: "unit-02" }),
    ]);
    assert.equal(grupos.length, 2);
  });

  it("no mezcla tipos distintos en el mismo punto", () => {
    // Una irregularidad de vía y un frenado en el mismo lugar son dos
    // hechos, aunque el segundo pueda ser consecuencia del primero.
    const grupos = agruparDetecciones([
      deteccion({ kind: "track_irregularity" }),
      deteccion({ kind: "hard_brake" }),
    ]);
    assert.equal(grupos.length, 2);
  });

  it("usa la precisión de cada lectura, no una tolerancia fija", () => {
    // 150 m separan estos puntos: con un fix de 200 m de error entran
    // en el mismo grupo, con uno de 30 m no deberían.
    const impreciso = agruparDetecciones([
      deteccion({ accuracyM: 200 }),
      deteccion({ ...alNorte(150), accuracyM: 200, unitCode: "unit-02" }),
    ]);
    const preciso = agruparDetecciones([
      deteccion({ accuracyM: 30 }),
      deteccion({ ...alNorte(150), accuracyM: 30, unitCode: "unit-02" }),
    ]);
    assert.equal(impreciso.length, 1, "con GPS impreciso deben agruparse");
    assert.equal(preciso.length, 2, "con GPS preciso deben quedar separados");
  });

  it("no parte un defecto extendido a lo largo de la vía", () => {
    // Tres puntos en cadena, cada salto por debajo de la tolerancia
    // (30 m con accuracyM=30) pero los extremos a 50 m, más que ella:
    // sin crecimiento por vecindad el del medio quedaría suelto.
    const grupos = agruparDetecciones([
      deteccion(),
      deteccion({ ...alNorte(25), unitCode: "unit-02" }),
      deteccion({ ...alNorte(50), unitCode: "unit-03" }),
    ]);
    assert.equal(grupos.length, 1, "la cadena debe quedar en un solo grupo");
  });
});

describe("pasadas", () => {
  it("cuenta una sola pasada cuando las detecciones son seguidas", () => {
    // Un tren largo sobre un bache dispara varias veces en segundos.
    const base = new Date("2026-09-30T10:00:00Z").getTime();
    const n = contarPasadas([
      deteccion({ ts: new Date(base) }),
      deteccion({ ts: new Date(base + 2000) }),
      deteccion({ ts: new Date(base + 5000) }),
    ]);
    assert.equal(n, 1);
  });

  it("cuenta pasadas distintas separadas en el tiempo", () => {
    const base = new Date("2026-09-30T10:00:00Z").getTime();
    const n = contarPasadas([
      deteccion({ ts: new Date(base) }),
      deteccion({ ts: new Date(base + 3600_000) }),
    ]);
    assert.equal(n, 2);
  });
});

describe("confianza", () => {
  it("confirma con tres unidades distintas", () => {
    const { confianza } = evaluarConfianza([
      deteccion({ unitCode: "unit-01" }),
      deteccion({ unitCode: "unit-02" }),
      deteccion({ unitCode: "unit-03" }),
    ]);
    assert.equal(confianza, "confirmado");
  });

  it("no confirma con un solo vehículo, por muchas veces que lo vea", () => {
    // Es el caso que este análisis existe para evitar: un soporte flojo
    // dispara siempre y parecería un defecto de vía.
    const base = new Date("2026-09-30T10:00:00Z").getTime();
    const { confianza, motivo } = evaluarConfianza([
      deteccion({ ts: new Date(base) }),
      deteccion({ ts: new Date(base + 3600_000) }),
      deteccion({ ts: new Date(base + 7200_000) }),
      deteccion({ ts: new Date(base + 10800_000) }),
    ]);
    assert.equal(confianza, "probable");
    assert.match(motivo, /otra unidad/);
  });

  it("no cuenta dos nodos del mismo vehículo como independientes", () => {
    const { confianza, motivo } = evaluarConfianza([
      deteccion({ nodeCode: "unit-01-a", unitCode: "unit-01" }),
      deteccion({ nodeCode: "unit-01-b", unitCode: "unit-01" }),
    ]);
    assert.equal(confianza, "indicio");
    assert.match(motivo, /mismo vehículo/);
  });

  it("el descarte del operador pesa más que el conteo", () => {
    const { confianza } = evaluarConfianza([
      deteccion({ unitCode: "unit-01", verdict: "false_alarm" }),
      deteccion({ unitCode: "unit-02", verdict: "false_alarm" }),
      deteccion({ unitCode: "unit-03", verdict: "false_alarm" }),
      deteccion({ unitCode: "unit-04" }),
    ]);
    assert.equal(confianza, "indicio");
  });

  it("dos unidades más una confirmación del operador bastan", () => {
    const { confianza } = evaluarConfianza([
      deteccion({ unitCode: "unit-01", verdict: "confirmed" }),
      deteccion({ unitCode: "unit-02" }),
    ]);
    assert.equal(confianza, "confirmado");
  });
});

describe("análisis completo", () => {
  it("ordena lo confirmado antes que los indicios", () => {
    const lejos = { lat: BASE.lat + 0.05, lon: BASE.lon };
    const defectos = analizarDefectos([
      // Un indicio suelto
      deteccion({ ...lejos, value: 0.9 }),
      // Un defecto confirmado por tres unidades
      deteccion({ unitCode: "unit-01", value: 0.2 }),
      deteccion({ unitCode: "unit-02", value: 0.2 }),
      deteccion({ unitCode: "unit-03", value: 0.2 }),
    ]);

    assert.equal(defectos.length, 2);
    assert.equal(defectos[0]!.confianza, "confirmado");
    assert.equal(defectos[0]!.unidadesDistintas, 3);
    // El indicio va después aunque su severidad sea mayor: primero se
    // inspecciona lo que se sabe que existe.
    assert.equal(defectos[1]!.confianza, "indicio");
  });

  it("descarta detecciones sin GPS en vez de situarlas en el ecuador", () => {
    const defectos = analizarDefectos([
      deteccion({ lat: Number.NaN, lon: Number.NaN }),
      deteccion({ unitCode: "unit-02" }),
    ]);
    assert.equal(defectos.length, 1);
    assert.equal(defectos[0]!.detecciones.length, 1);
  });

  it("pondera el centro por precisión del fix", () => {
    // Una lectura precisa cerca del origen y otra imprecisa a 200 m: el
    // centro debe quedar mucho más cerca de la precisa.
    const defectos = analizarDefectos([
      deteccion({ accuracyM: 10 }),
      deteccion({ ...alNorte(200), accuracyM: 200, unitCode: "unit-02" }),
    ]);
    const centro = defectos[0]!;
    const aPrecisa = distanciaM(centro, BASE);
    const aImprecisa = distanciaM(centro, alNorte(200));
    assert.ok(
      aPrecisa < aImprecisa,
      `el centro debería acercarse al fix preciso (${aPrecisa} vs ${aImprecisa})`,
    );
  });
});
