# sit-ciit-backend

## Resumen

API REST + suscriptor MQTT + WebSocket (Socket.IO) para el dashboard de
SIT-CIIT, sistema de telemetría/control remoto para monitorear carga en el
Corredor Interoceánico del Istmo de Tehuantepec. Node 20+/TypeScript,
Fastify, arquitectura hexagonal (`src/README.md`).

Repos hermanos: `sit-ciit-infra` (contrato, broker, BD), `sit-ciit-mobile`,
`sit-ciit-dashboard`.

## Restricciones del proyecto (aplican a todo SIT-CIIT)

- **No hay hardware dedicado**: los nodos son celulares Android con
  sensores reales. El backend debe hablar únicamente el contrato MQTT —
  no debe asumir nada específico de "ser un celular" para poder aceptar
  un ESP32 como nodo más adelante sin cambios de diseño.
- **Prohibido simular datos** en el flujo real: nada de generadores de
  telemetría falsa ni seeders con datos de sensor inventados. Los tests
  unitarios sí pueden usar fixtures.
- Fuera del MVP: SMS por servidor queda como adaptador con interfaz lista
  pero **sin implementar**.

## Contrato

- Fuente de verdad: `sit-ciit-infra/contracts/`. Copia local en
  `src/contract/contract.ts` (no editar ahí, correr
  `sit-ciit-infra/scripts/sync-contract.sh`).
- Reglas de autoridad de comandos: `control_center` puede todo;
  `operator` solo `trigger_alarm`/`stop_alarm`. El backend **debe**
  validar la autoridad antes de publicar en MQTT (el nodo revalida y
  puede responder `rejected`, pero la primera línea de defensa es aquí).
- Deduplicar mensajes entrantes por `msgId` (constraint `UNIQUE` en BD).
- Guardar tanto `ts` (reloj del dispositivo) como `received_at` (reloj del
  servidor) — la diferencia es lo que el dashboard usa para marcar
  eventos que llegaron tarde por sincronización offline.

## Reglas de dominio a implementar (ver fases)

- Nodo sin heartbeat en 15 s → offline.
- Si `primary` cae y `backup` de la misma unidad está online → fuente
  activa pasa a backup, se registra evento `source_failover`, se notifica
  por WebSocket. Al volver `primary`, la fuente regresa y se registra.
- Si `primary` y `backup` están ambos online y uno reporta `impact`
  critical sin que el otro registre algo similar en ±3 s → evento
  `sensor_disagreement` (warning). Nota: `source_failover` y
  `sensor_disagreement` son generados por el backend, no llegan por MQTT
  — no forman parte del `EventKind` del contrato de dispositivo, pero se
  guardan en la misma tabla `events`.
- Eventos `critical` → push por Socket.IO y, si hay token, por Telegram.

## Comandos útiles

```bash
npm install
npm run dev          # tsx watch, requiere .env y sit-ciit-infra corriendo
npm run typecheck
npm run build && npm run start
npm run migrate      # corre migraciones SQL (scripts/migrate.ts)
npm run create-user  # alta de usuario control_center/operator (no telemetría falsa)
```

## Cosas a NO hacer

- No agregar un seed de telemetría "de ejemplo" — viola la restricción de
  no simular datos. Para probar sin celular, usar `mosquitto_pub` a mano
  con un payload real construido según el contrato (documentar el comando
  exacto en el README de pruebas cuando se necesite, no automatizarlo como
  generador).
- No mover la validación de autoridad de comandos solo al nodo: el
  backend valida primero.
