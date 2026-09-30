-- Recuperación observada por heartbeat; no es un evento MQTT del dispositivo.
ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'signal_recovered';
