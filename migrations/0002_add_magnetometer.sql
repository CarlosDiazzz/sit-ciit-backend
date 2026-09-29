-- Contrato v1.1.0: magnetómetro crudo (µT) en telemetry — ver
-- sit-ciit-infra/contracts/CHANGELOG.md. Lectura cruda, no un rumbo:
-- calcular eso necesita compensar inclinación con el acelerómetro y
-- calibración, queda fuera del MVP (documentado como roadmap).

ALTER TABLE telemetry
  ADD COLUMN mag_x DOUBLE PRECISION,
  ADD COLUMN mag_y DOUBLE PRECISION,
  ADD COLUMN mag_z DOUBLE PRECISION;
