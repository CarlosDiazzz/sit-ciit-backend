-- Hoy evaluateLiveness solo deja rastro cuando la caída de un nodo
-- cambia la fuente activa de la unidad (source_failover) — un backup
-- que se cae sin causar failover no queda registrado en ningún lado.
-- Este valor cierra ese hueco: se registra por cada nodo que se cae,
-- con su última posición GPS real conocida (ver evaluateLiveness.ts).
--
-- En su propia migración: Postgres no permite usar un valor de enum
-- recién agregado en la misma transacción que lo agrega.

ALTER TYPE event_kind ADD VALUE 'signal_lost';
