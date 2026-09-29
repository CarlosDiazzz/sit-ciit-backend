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

## Contrato

`src/contract/contract.ts` es una copia sincronizada desde
`sit-ciit-infra/contracts/contract.ts`. No editar aquí directamente — ver
`sit-ciit-infra/scripts/sync-contract.sh`.

## Estado

Fase 0 (andamiaje): solo existe `GET /health`. El resto de los endpoints,
el suscriptor MQTT, migraciones y módulos de dominio se agregan en las
fases siguientes (ver `CLAUDE.md` del repo `sit-ciit-infra` para el plan
de fases completo).
