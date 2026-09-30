-- Contrato v1.2.0: eventos de dinámica de marcha detectados en el nodo.
--
-- El enum event_kind es rígido: sin estos valores, un mensaje con
-- kind='hard_brake' falla al insertarse y el evento se pierde.
--
-- ALTER TYPE ... ADD VALUE no puede correr dentro de una transacción en
-- versiones de Postgres anteriores a la 12. En PG16 sí puede, pero el
-- valor nuevo no es utilizable hasta que la transacción termina — por
-- eso esta migración solo agrega valores y no los usa.

ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'hard_brake';
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'curve_overspeed';
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'dynamic_impact';
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'track_irregularity';
