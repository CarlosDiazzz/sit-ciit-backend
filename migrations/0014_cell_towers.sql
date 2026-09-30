-- Torres celulares reales (OpenCelliD), cacheadas: no se le pega a la
-- API en cada request — las antenas casi no cambian de lugar y el free
-- tier tiene límite diario. Se reemplaza por completo en cada refresh
-- (ver refreshCellTowers.ts), no se hace upsert incremental.
CREATE TABLE cell_towers (
  id BIGSERIAL PRIMARY KEY,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  radio TEXT,
  -- Rango real que reporta OpenCelliD para esa torre, en metros. NULL
  -- cuando esa torre en particular no trae uno — nunca se rellena con un
  -- número inventado aquí; el supuesto conservador, si se necesita, se
  -- aplica en el dashboard y se marca como tal (isAssumption).
  range_m DOUBLE PRECISION,
  mcc INTEGER,
  mnc INTEGER,
  samples INTEGER,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cell_towers_fetched_at_idx ON cell_towers (fetched_at);
