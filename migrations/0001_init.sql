-- SIT-CIIT — esquema inicial (3FN)
-- Ver sit-ciit-backend/docs/schema.md para el diagrama ER y la
-- justificación de normalización, y docs/adr/0001-modelo-de-datos-3fn.md
-- para las decisiones de diseño.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------------
-- Enums (evitan strings mágicos repetidos sueltos en cada tabla)
-- ---------------------------------------------------------------------

CREATE TYPE user_role AS ENUM ('control_center', 'operator');
CREATE TYPE node_role AS ENUM ('primary', 'backup');
CREATE TYPE node_mode AS ENUM ('normal', 'inspection', 'alarm');
CREATE TYPE event_kind AS ENUM (
  'impact', 'door_open', 'door_closed', 'rollover', 'threshold_exceeded',
  -- generados por el backend, no llegan por MQTT (ver docs/schema.md)
  'source_failover', 'sensor_disagreement'
);
CREATE TYPE event_severity AS ENUM ('info', 'warning', 'critical');
CREATE TYPE cmd_action AS ENUM (
  'set_sampling_rate', 'set_thresholds', 'trigger_alarm',
  'stop_alarm', 'set_mode', 'toggle_sensor'
);
CREATE TYPE command_status AS ENUM ('sent', 'delivered', 'executed', 'rejected');

-- ---------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- units
-- ---------------------------------------------------------------------

CREATE TABLE units (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_code  TEXT NOT NULL UNIQUE,   -- ej. "unit-01" (= unitId del contrato)
  label      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- nodes
-- ---------------------------------------------------------------------

CREATE TABLE nodes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_code          TEXT NOT NULL UNIQUE,  -- ej. "unit-01-a" (= nodeId del contrato)
  unit_id            UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  role               node_role NOT NULL,
  is_online          BOOLEAN NOT NULL DEFAULT false,
  last_heartbeat_at  TIMESTAMPTZ,
  -- snapshot del último heartbeat (no hay tabla de historial de heartbeats,
  -- ver docs/schema.md — la sección 5 del plan solo pide guardar el estado
  -- actual del nodo, no cada latido)
  battery_pct        NUMERIC(5, 2),
  pending_outbox     INTEGER,
  sampling_ms        INTEGER,
  mode               node_mode,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (unit_id, role) -- a lo sumo un primary y un backup por unidad
);

-- capabilities del heartbeat como tabla aparte (no array) para no romper 1FN
-- con un grupo repetitivo dentro de nodes.
CREATE TABLE node_capabilities (
  node_id    UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  PRIMARY KEY (node_id, capability)
);

-- Fuente activa de la unidad (primary o backup). Se agrega después de
-- crear "nodes" porque las dos tablas se referencian mutuamente.
ALTER TABLE units
  ADD COLUMN active_node_id UUID REFERENCES nodes(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- telemetry (hypertable — alto volumen, particionada por ts)
-- ---------------------------------------------------------------------

CREATE TABLE telemetry (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  msg_id          UUID NOT NULL,      -- para deduplicar reintentos QoS 1
  node_id         UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  ts              TIMESTAMPTZ NOT NULL,          -- reloj del dispositivo
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(), -- reloj del servidor
  accel_x         DOUBLE PRECISION,
  accel_y         DOUBLE PRECISION,
  accel_z         DOUBLE PRECISION,
  gyro_x          DOUBLE PRECISION,
  gyro_y          DOUBLE PRECISION,
  gyro_z          DOUBLE PRECISION,
  lux             DOUBLE PRECISION,
  pressure_hpa    DOUBLE PRECISION,
  gps_lat         DOUBLE PRECISION,
  gps_lon         DOUBLE PRECISION,
  gps_speed_ms    DOUBLE PRECISION,
  gps_accuracy_m  DOUBLE PRECISION,
  -- TimescaleDB exige que la columna de partición (ts) forme parte de
  -- cualquier PK/UNIQUE de una hypertable. "id" ya es único por sí solo
  -- (UUID generado en el momento del insert); (id, ts) es un requisito
  -- físico del particionado, no una clave de negocio compuesta.
  PRIMARY KEY (id, ts)
);

SELECT create_hypertable('telemetry', by_range('ts'));

-- único real de negocio: no procesar dos veces el mismo msgId
CREATE UNIQUE INDEX telemetry_msg_id_ts_key ON telemetry (msg_id, ts);
CREATE INDEX telemetry_node_ts_idx ON telemetry (node_id, ts DESC);

-- ---------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------

CREATE TABLE events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  msg_id           UUID,   -- NULL para eventos generados por el backend
                           -- (source_failover, sensor_disagreement)
  unit_id          UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  node_id          UUID REFERENCES nodes(id) ON DELETE SET NULL,
  -- node_id es NULL en eventos a nivel unidad (failover/disagreement,
  -- comparan primary vs backup, no pertenecen a un solo nodo). unit_id se
  -- guarda explícito (no solo derivado de nodes.unit_id) precisamente
  -- porque node_id puede ser NULL — ver docs/schema.md.
  kind             event_kind NOT NULL,
  severity         event_severity NOT NULL,
  value            DOUBLE PRECISION,
  threshold        DOUBLE PRECISION,
  gps_lat          DOUBLE PRECISION,
  gps_lon          DOUBLE PRECISION,
  ts               TIMESTAMPTZ NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at  TIMESTAMPTZ,
  acknowledged_by  UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (msg_id)
);

CREATE INDEX events_unit_ts_idx ON events (unit_id, ts DESC);

-- ---------------------------------------------------------------------
-- commands (estado actual) + command_log (bitácora, historial completo)
-- ---------------------------------------------------------------------

CREATE TABLE commands (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmd_id             UUID NOT NULL UNIQUE,  -- cmdId del contrato
  target_node_id     UUID NOT NULL REFERENCES nodes(id),
  issued_by_user_id  UUID NOT NULL REFERENCES users(id),
  issued_by_role     user_role NOT NULL,
  -- snapshot del rol al momento de emitir el comando: es un hecho
  -- histórico ("con qué autoridad se emitió"), no un duplicado del rol
  -- actual del usuario (que puede cambiar después) — no viola 3FN.
  action             cmd_action NOT NULL,
  params             JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             command_status NOT NULL DEFAULT 'sent',
  reason             TEXT,
  issued_at          TIMESTAMPTZ NOT NULL,
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at       TIMESTAMPTZ,
  executed_at        TIMESTAMPTZ,
  rejected_at        TIMESTAMPTZ
);

CREATE INDEX commands_target_node_idx ON commands (target_node_id, sent_at DESC);

CREATE TABLE command_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id  UUID NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  msg_id      UUID,  -- msgId del ack que originó esta fila; NULL en la fila
                      -- inicial "sent" (la crea el backend, no llega por MQTT)
  status      command_status NOT NULL,
  reason      TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (msg_id)
);

CREATE INDEX command_log_command_idx ON command_log (command_id, occurred_at);
