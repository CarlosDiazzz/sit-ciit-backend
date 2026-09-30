-- Veredicto del operador sobre un evento.
--
-- `acknowledged_at` solo dice que alguien lo vio. Para saber si la
-- deteccion acerto hace falta el juicio de quien conoce el contexto: el
-- nodo no puede distinguir un bache real de que movieran la caja al
-- cargar, pero el centro de control si.
--
-- Cada veredicto es ademas un ejemplo etiquetado: es lo que convierte la
-- operacion diaria en datos para afinar los umbrales o, mas adelante,
-- entrenar un modelo.

CREATE TYPE event_verdict AS ENUM (
  'confirmed',   -- ocurrio de verdad
  'false_alarm', -- el sensor disparo sin causa real
  'unclear'      -- no hay forma de saberlo
);

ALTER TABLE events ADD COLUMN verdict event_verdict;
ALTER TABLE events ADD COLUMN verdict_note TEXT;

-- Los eventos ya revisados sin veredicto quedan en NULL: no se inventa
-- una etiqueta que nadie dio.
CREATE INDEX events_verdict_idx ON events (verdict) WHERE verdict IS NOT NULL;
