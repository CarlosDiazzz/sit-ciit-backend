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

## Base de datos

Esquema en `migrations/0001_init.sql`, aplicado con `npm run migrate`
(runner propio en `scripts/migrate.ts`, sin ORM — ver
`docs/adr/0001-modelo-de-datos-3fn.md`). Diagrama ER y justificación de
normalización (3FN) en `docs/schema.md` — leerlo antes de tocar el
esquema o de escribir queries que crucen `nodes`/`units`/`events`.

Puntos que no son obvios leyendo solo el DDL:
- No hay tabla de heartbeats: el heartbeat solo actualiza el estado
  actual en `nodes` (`last_heartbeat_at`, `battery_pct`, `pending_outbox`,
  `sampling_ms`, `mode`, `is_online`).
- `nodes.role` (primary/backup) y `users.role` (control_center/operator)
  son conceptos distintos que solo comparten nombre de columna.
- `commands.issued_by_role` es un snapshot histórico, no se actualiza si
  el usuario cambia de rol después.
- `events.unit_id` se guarda explícito (no solo vía `node_id`) porque
  `node_id` es NULL en `source_failover`/`sensor_disagreement`.

## Ingesta de telemetría (Fase 1, ya implementada)

`src/adapters/in/mqtt/TelemetrySubscriber.ts` se suscribe a
`sitciit/+/telemetry`, valida con Zod (`messageSchemas.ts`, espejo del
contrato) y llama a `application/ingestTelemetry.ts`, que delega en
`PgTelemetryRepository` (`adapters/out/postgres`).

Puntos no obvios:
- **No hay endpoint de alta de nodos.** El contrato no define uno, así
  que `PgTelemetryRepository.ensureNode()` da de alta `units`/`nodes` por
  upsert (`ON CONFLICT ... DO UPDATE`) en el primer mensaje que ve de un
  `nodeId`/`unitId` nuevo. Si esto cambia (ej. se agrega un flujo de
  aprovisionamiento explícito), quitar el auto-registro de aquí.
- **Dedup real**: `ON CONFLICT (msg_id, ts) DO NOTHING` en el insert de
  `telemetry` — reintentos QoS 1 del mismo mensaje no generan filas
  duplicadas. Verificado manualmente reenviando el mismo `msgId`.
- Mensajes que no pasan Zod o que no son JSON válido se descartan con un
  `logger.warn` (no tumban el proceso ni la conexión MQTT).
- Cada telemetría guardada con éxito (no duplicada) se reemite por
  Socket.IO (`adapters/in/ws/SocketTelemetryBroadcaster`, evento
  `telemetry`) para que el dashboard grafique en vivo. CORS del socket
  está abierto (`origin: "*"`) porque todavía no hay auth — restringir
  cuando se agregue login al dashboard (Fase 6).

## Heartbeat y failover (ya implementado)

`adapters/in/mqtt/HeartbeatSubscriber.ts` se engancha al **mismo** cliente
MQTT del suscriptor de telemetría (un solo clientId por proceso: el broker
desconecta duplicados, ADR 0002) y se suscribe a `sitciit/+/heartbeat`.
`application/ingestHeartbeat.ts` guarda el estado en `nodes` y, si el nodo
estaba dado por caído, gestiona su regreso.

La caída no genera ningún mensaje, así que hay que ir a buscarla:
`adapters/in/scheduler/livenessWatcher.ts` llama cada 5 s a
`application/evaluateLiveness.ts`, que marca offline a los nodos sin
heartbeat en 15 s (`OFFLINE_AFTER_MS`) y reasigna la fuente activa.

Puntos no obvios:
- Varias caídas en la misma unidad se resuelven en una sola pasada: al
  procesarlas por separado, la primera reasignaría la fuente a un nodo que
  la segunda va a tumbar enseguida.
- Las `capabilities` se reemplazan enteras en cada heartbeat: la lista es
  la de sensores disponibles *ahora*, y uno puede dejar de estarlo.
- El intervalo del vigilante (5 s) es más fino que el umbral (15 s) para
  que la detección no se retrase hasta 30 s.
- `source_failover` se guarda con `node_id` NULL (es de la unidad) y
  severidad `warning` al caer a backup, `info` al volver el primary, y
  `critical` si ningún nodo queda vivo.
- Socket.IO emite `node:status` y `unit:active-node` para que el dashboard
  refleje el cambio sin recargar.

## Reglas de dominio a implementar (ver fases)

- Nodo sin heartbeat en 15 s → offline. **(hecho, ver arriba)**
- Si `primary` cae y `backup` de la misma unidad está online → fuente
  activa pasa a backup, se registra evento `source_failover`, se notifica
  por WebSocket. Al volver `primary`, la fuente regresa y se registra.
  **(hecho, ver arriba)**
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
