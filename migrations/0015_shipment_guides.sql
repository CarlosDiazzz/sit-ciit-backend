-- Folios atómicos, únicos e independientes de entradas del formulario.
-- Los folios existentes se conservan para no romper referencias previas.
CREATE SEQUENCE shipment_guide_seq;
SELECT setval('shipment_guide_seq', greatest(1, coalesce(
  (SELECT max(substring(code from '^SITCIIT-[0-9]{4}-([0-9]+)$')::bigint) FROM shipments), 0)),
  EXISTS(SELECT 1 FROM shipments WHERE code ~ '^SITCIIT-[0-9]{4}-[0-9]+$'));
CREATE FUNCTION next_shipment_guide() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'SITCIIT-' || to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYY') || '-' ||
    CASE WHEN length(n::text)<6 THEN lpad(n::text,6,'0') ELSE n::text END
  FROM nextval('shipment_guide_seq') n;
$$;
ALTER TABLE shipments ALTER COLUMN code SET DEFAULT next_shipment_guide();
