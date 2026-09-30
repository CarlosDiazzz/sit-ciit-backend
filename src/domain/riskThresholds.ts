import type { EventSeverity } from "../contract/contract.js";

/** Categorías de negocio del cliente — no viene de un sensor, se declara
 *  por unidad desde el dashboard (ver UnitRepository.setCargoCategory).
 *  'sin_carga' es un estado explícito ("esta unidad va vacía ahorita"),
 *  distinto de NULL (todavía no se declaró nada). No hay reglas de
 *  riesgo para 'sin_carga' en RISK_RULES — evaluateWeatherRisk devuelve
 *  un arreglo vacío para esa categoría sin necesitar un caso especial. */
export type CargoCategory = "agricola" | "construccion" | "quimico" | "sin_carga";

/** Dato ambiental real (Open-Meteo) en la última posición GPS conocida de
 *  la unidad. Importante: esto es clima AMBIENTAL de la ruta, no la
 *  temperatura/humedad dentro del contenedor — el celular no tiene forma
 *  de medir eso (ver propuesta, sección 4.1: "no disponible"). Las reglas
 *  de abajo solo usan variables donde lo ambiental es, por definición, la
 *  variable relevante (ej. humedad que activa hongos en grano almacenado,
 *  o temperatura ambiente cerca de un umbral de autoaceleración térmica),
 *  nunca como sustituto de una norma de cadena de frío que exige medir la
 *  carga misma. */
export interface WeatherReading {
  tempC: number;
  humidityPct: number;
  precipMm: number;
}

export type WeatherVariable = keyof WeatherReading;

/** Condición declarativa (no una función) para que el mismo umbral que se
 *  evalúa se pueda mostrar tal cual en el dashboard — "bajo qué valor y
 *  qué norma" no debe vivir escondido dentro de un closure. */
export interface Condition {
  variable: WeatherVariable;
  op: ">=" | "<=" | ">" | "<";
  value: number;
}

export interface RiskRule {
  id: string;
  category: CargoCategory;
  severity: EventSeverity;
  message: string;
  /** Cita exacta de la norma/guía real que respalda el umbral. */
  source: string;
  /** true = no se encontró una cifra oficial confirmada; es un criterio
   *  del equipo, y debe mostrarse como tal en el dashboard, no ocultarse. */
  isAssumption: boolean;
  /** Se cumplen todas (AND) para que la regla se considere activa. */
  conditions: Condition[];
}

export const RISK_RULES: RiskRule[] = [
  {
    id: "agricola_humedad_hongos",
    category: "agricola",
    severity: "warning",
    message: "Humedad ambiental favorece el crecimiento de hongos en grano almacenado/transportado.",
    source: "FAO — guía de almacenamiento de granos (activación de moho ≥65-70% HR)",
    isAssumption: false,
    conditions: [{ variable: "humidityPct", op: ">=", value: 70 }],
  },
  {
    id: "agricola_aflatoxinas",
    category: "agricola",
    severity: "critical",
    message: "Condiciones ambientales óptimas para Aspergillus flavus (productor de aflatoxinas) en grano.",
    source: "FAO — condiciones óptimas de crecimiento de Aspergillus flavus (~20-35°C, ≥85% HR)",
    isAssumption: false,
    conditions: [
      { variable: "tempC", op: ">=", value: 20 },
      { variable: "tempC", op: "<=", value: 35 },
      { variable: "humidityPct", op: ">=", value: 85 },
    ],
  },
  {
    id: "agricola_lluvia",
    category: "agricola",
    severity: "info",
    message: "Lluvia activa en la ruta: riesgo de humedad si la carga a granel no está protegida.",
    source: "Criterio del equipo (no hay norma que dé un umbral de mm exacto para esto)",
    isAssumption: true,
    conditions: [{ variable: "precipMm", op: ">", value: 0 }],
  },
  {
    id: "construccion_humedad_cemento",
    category: "construccion",
    severity: "warning",
    message: "Humedad relativa elevada: riesgo de hidratación prematura del cemento en sacos.",
    source:
      "Guía general de industria sobre sensibilidad del cemento a la humedad; NMX-C-414-ONNCCE identificada como la norma aplicable, pero no se confirmó su cifra exacta de HR — umbral aproximado",
    isAssumption: true,
    conditions: [{ variable: "humidityPct", op: ">=", value: 80 }],
  },
  {
    id: "construccion_lluvia",
    category: "construccion",
    severity: "warning",
    message: "Lluvia activa: alto riesgo si el cemento no está cubierto/impermeabilizado.",
    source: "Criterio del equipo (no hay norma que dé un umbral de mm exacto para esto)",
    isAssumption: true,
    conditions: [{ variable: "precipMm", op: ">", value: 0 }],
  },
  {
    id: "quimico_sadt",
    category: "quimico",
    severity: "warning",
    message:
      "Temperatura ambiente se acerca a un umbral de autoaceleración de descomposición (SADT) considerado crítico para sustancias sensibles al calor — verificar ficha de seguridad de la sustancia transportada.",
    source: "UN Recommendations on the Transport of Dangerous Goods (Orange Book) — concepto SADT",
    isAssumption: false,
    conditions: [{ variable: "tempC", op: ">=", value: 45 }],
  },
  {
    id: "quimico_resistencia_envase",
    category: "quimico",
    severity: "critical",
    message: "Temperatura ambiente excede el rango de resistencia térmica exigido a envases de sustancias peligrosas.",
    source: "NOM-002-SCT/2011 (resistencia térmica de envases, +55°C)",
    isAssumption: false,
    conditions: [{ variable: "tempC", op: ">=", value: 55 }],
  },
];

const SEVERITY_RANK: Record<EventSeverity, number> = { info: 0, warning: 1, critical: 2 };

function evaluateCondition(c: Condition, w: WeatherReading): boolean {
  const actual = w[c.variable];
  switch (c.op) {
    case ">=":
      return actual >= c.value;
    case "<=":
      return actual <= c.value;
    case ">":
      return actual > c.value;
    case "<":
      return actual < c.value;
  }
}

function ruleApplies(rule: RiskRule, w: WeatherReading): boolean {
  return rule.conditions.every((c) => evaluateCondition(c, w));
}

/** Reglas activas de una categoría para un dato de clima real dado. Función
 *  pura — sin red ni DB, 100% testeable con fixtures fijos. */
export function evaluateWeatherRisk(category: CargoCategory, weather: WeatherReading): RiskRule[] {
  return RISK_RULES.filter((rule) => rule.category === category && ruleApplies(rule, weather));
}

/** La severidad más alta entre las reglas activas, o null si ninguna aplicó. */
export function highestSeverity(rules: RiskRule[]): EventSeverity | null {
  if (rules.length === 0) return null;
  return rules.reduce<EventSeverity>(
    (max, r) => (SEVERITY_RANK[r.severity] > SEVERITY_RANK[max] ? r.severity : max),
    rules[0]!.severity
  );
}
