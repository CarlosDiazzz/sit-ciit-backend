-- Riesgo climático por tipo de carga.
--
-- cargo_category como columna simple en units (no tabla aparte): una
-- unidad declara un solo tipo de carga a la vez, mismo patrón que
-- unit_code/label — ver docs/adr/0001-modelo-de-datos-3fn.md.
--
-- weather_readings guarda el dato crudo real de Open-Meteo (nunca
-- inventado) en la última posición GPS conocida de la unidad, para poder
-- graficar su historia y auditar de dónde salió cada advertencia.
--
-- events.details JSONB: una advertencia de clima compara varias variables
-- (temperatura, humedad, lluvia) contra varias reglas a la vez — no cabe
-- en las columnas value/threshold (pensadas para un solo número), mismo
-- precedente que commands.params JSONB.

CREATE TYPE cargo_category AS ENUM ('agricola', 'construccion', 'quimico');

ALTER TABLE units ADD COLUMN cargo_category cargo_category;

CREATE TABLE weather_readings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat          DOUBLE PRECISION NOT NULL,
  lon          DOUBLE PRECISION NOT NULL,
  temp_c       DOUBLE PRECISION,
  humidity_pct DOUBLE PRECISION,
  precip_mm    DOUBLE PRECISION,
  source       TEXT NOT NULL DEFAULT 'open-meteo'
);

CREATE INDEX weather_readings_unit_ts_idx ON weather_readings (unit_id, ts DESC);

ALTER TABLE events ADD COLUMN details JSONB;
