-- En su propia migración: Postgres no permite usar un valor de enum recién
-- agregado en la misma transacción que lo agrega, y el runner aplica cada
-- archivo como una sola transacción (scripts/migrate.ts).

ALTER TYPE event_kind ADD VALUE 'weather_risk';
