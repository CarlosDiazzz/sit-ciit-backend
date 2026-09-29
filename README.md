# sit-ciit-backend

API REST + suscriptor MQTT + WebSocket para el dashboard de **SIT-CIIT**.
Node 20+ / TypeScript, Fastify, arquitectura hexagonal.

Requiere `sit-ciit-infra` corriendo (Mosquitto + TimescaleDB).

## Setup

```bash
npm install
cp .env.example .env   # ajustar DATABASE_URL / MQTT_* según sit-ciit-infra
npm run dev
```

`GET http://localhost:3000/health` debe responder `{"status":"ok"}`.

## Estructura

Ver [`src/README.md`](src/README.md) para el detalle de la arquitectura
hexagonal (domain / application / adapters).

## Base de datos

Esquema normalizado a 3FN — diagrama ER y justificación completa en
[`docs/schema.md`](docs/schema.md) (ver también
[`docs/adr/0001-modelo-de-datos-3fn.md`](docs/adr/0001-modelo-de-datos-3fn.md)).

```bash
npm run migrate   # aplica migrations/*.sql en orden (idempotente)
```

Requiere `DATABASE_URL` apuntando al TimescaleDB de `sit-ciit-infra`
(por defecto puerto **5433**, no 5432 — ver `POSTGRES_HOST_PORT` en ese
repo, elegido para no chocar con un Postgres nativo del sistema).

## Contrato

`src/contract/contract.ts` es una copia sincronizada desde
`sit-ciit-infra/contracts/contract.ts`. No editar aquí directamente — ver
`sit-ciit-infra/scripts/sync-contract.sh`.

## Estado

Fase 1 (en progreso): suscriptor MQTT (`sitciit/+/telemetry`) que valida
con Zod, da de alta unit/node automáticamente en el primer mensaje que ve
de ellos, deduplica por `msgId` y guarda en la hypertable `telemetry`.
`GET /telemetry?unitId&from&to` para consultarla. Cada telemetría guardada
con éxito se reemite por Socket.IO (evento `telemetry`) para que el
dashboard la grafique en vivo. `GET /health` sigue disponible. Falta:
eventos, comandos, auth.
