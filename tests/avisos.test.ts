import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { avisoDeConsulta, avisoDeSesion } from "../src/domain/avisos.js";

const AHORA = new Date("2026-09-30T20:32:00Z");

describe("aviso de inicio de sesión", () => {
  it("nombra la cuenta y dice qué hacer si no fue el usuario", () => {
    const a = avisoDeSesion({ email: "cliente@empresa.mx", cuando: AHORA });
    assert.match(a.subject, /Inicio de sesión/);
    assert.match(a.text, /cliente@empresa\.mx/);
    assert.match(a.text, /Si no fuiste tú/);
  });

  it("incluye la empresa cuando se conoce", () => {
    const a = avisoDeSesion({
      email: "cliente@empresa.mx",
      cuando: AHORA,
      empresa: "Transportes del Istmo",
    });
    assert.match(a.text, /Transportes del Istmo/);
  });
});

describe("aviso de consulta de envío", () => {
  const base = {
    email: "cliente@empresa.mx",
    referencia: "SIT-2026-000000123",
    descripcion: "Café verde en sacos",
    origen: "Salina Cruz",
    destino: "Coatzacoalcos",
    cuando: AHORA,
  };

  it("pone la referencia en el asunto, que es lo único que se lee en la bandeja", () => {
    const a = avisoDeConsulta({
      ...base,
      estado: "reporting",
      ultimoReporte: new Date(AHORA.getTime() - 4 * 60_000),
    });
    assert.match(a.subject, /SIT-2026-000000123/);
  });

  it("dice cuánto hace del último reporte, no una marca de tiempo cruda", () => {
    const a = avisoDeConsulta({
      ...base,
      estado: "reporting",
      ultimoReporte: new Date(AHORA.getTime() - 4 * 60_000),
    });
    assert.match(a.text, /hace 4 minutos/);
  });

  it("usa horas cuando corresponde", () => {
    const a = avisoDeConsulta({
      ...base,
      estado: "reporting",
      ultimoReporte: new Date(AHORA.getTime() - 3 * 3600_000),
    });
    assert.match(a.text, /hace 3 horas/);
  });

  it("sin reportes no dice 'sin datos': un cliente lo leería como avería", () => {
    const a = avisoDeConsulta({ ...base, estado: "waiting", ultimoReporte: null });
    assert.doesNotMatch(a.text, /sin datos/i);
    assert.match(a.text, /Todavía sin reportes/);
  });

  it("omite la ruta cuando no se conocen origen ni destino", () => {
    const a = avisoDeConsulta({
      ...base,
      origen: null,
      destino: null,
      estado: "waiting",
      ultimoReporte: null,
    });
    assert.doesNotMatch(a.text, /Ruta:/);
  });

  it("formatea en la zona del corredor, no en UTC", () => {
    const a = avisoDeConsulta({ ...base, estado: "waiting", ultimoReporte: null });
    // 20:32 UTC son las 2:32 p.m. en Ciudad de México (es-MX usa 12 h).
    assert.match(a.text, /2:32/);
    assert.match(a.text, /p\.\s?m\./);
  });
});
