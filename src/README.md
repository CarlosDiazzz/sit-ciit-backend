# Arquitectura del backend

Hexagonal: el dominio no conoce Fastify, MQTT ni Postgres.

```
domain/
  entities/   Unit, Node, TelemetryReading, Event, Command... (sin dependencias externas)
  ports/      interfaces que el dominio necesita (ej. TelemetryRepository,
              CommandPublisher) — las implementan los adaptadores de salida
application/
  casos de uso: ingestar telemetría, evaluar failover, emitir comando,
  validar autoridad, etc. Orquestan dominio + ports.
adapters/
  in/         entra al sistema: HTTP (Fastify routes), MQTT (suscriptor),
              WebSocket (Socket.IO emitter hacia el dashboard)
  out/        sale del sistema: Postgres (implementación de los ports),
              MQTT (publisher de comandos), proxies de Open-Meteo/OpenCelliD,
              Telegram
contract/
  contract.ts — copia sincronizada desde sit-ciit-infra (no editar aquí,
  ver sit-ciit-infra/scripts/sync-contract.sh)
```

Las subcarpetas de `adapters/in` y `adapters/out` se crean conforme se
implementa cada módulo (Fase 1 en adelante), no se dejan carpetas vacías
de antemano.
