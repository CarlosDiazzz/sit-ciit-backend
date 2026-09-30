-- Antes, "sin categoría declarada todavía" y "unidad viajando vacía" eran
-- lo mismo (NULL) — se veía arbitrario porque no había forma de decir
-- explícitamente "esta unidad no lleva carga ahorita" sin dejarla como si
-- nadie la hubiera configurado. 'sin_carga' es un cuarto valor real y
-- seleccionable, distinto de NULL (que sigue significando "sin declarar").
--
-- No hace falta ninguna otra restructuración: sigue siendo un atributo de
-- la unidad, solo que ahora "vacía" es un estado explícito. Las reglas de
-- riesgo climático (riskThresholds.ts) no definen ninguna para
-- 'sin_carga', así que evaluateWeatherRisk ya devuelve cero reglas para
-- ese caso sin necesitar código especial.

ALTER TYPE cargo_category ADD VALUE 'sin_carga';
