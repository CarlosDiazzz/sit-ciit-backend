# Esquema de base de datos

Postgres + TimescaleDB. Fuente de verdad: `migrations/0001_init.sql`
(aplicada con `npm run migrate`). Este documento es la vista legible del
mismo esquema, no una segunda fuente de verdad — si difieren, manda la
migración.

## Diagrama ER

```mermaid
erDiagram
    USERS {
        uuid id PK
        text email UK
        text password_hash
        enum role "control_center | operator"
    }

    UNITS {
        uuid id PK
        text unit_code UK "ej. unit-01"
        text label
        uuid active_node_id FK "fuente activa actual"
    }

    NODES {
        uuid id PK
        text node_code UK "ej. unit-01-a"
        uuid unit_id FK
        enum role "primary | backup"
        bool is_online
        timestamptz last_heartbeat_at
        numeric battery_pct
        int pending_outbox
        int sampling_ms
        enum mode "normal | inspection | alarm"
    }

    NODE_CAPABILITIES {
        uuid node_id FK
        text capability PK2 "ej. accelerometer, gps"
    }

    TELEMETRY {
        uuid id PK
        uuid msg_id UK "dedup QoS1"
        uuid node_id FK
        int seq
        timestamptz ts PK2 "reloj del dispositivo"
        timestamptz received_at "reloj del servidor"
        double accel_x_y_z
        double gyro_x_y_z
        double lux
        double pressure_hpa
        double gps_lat_lon_speed_accuracy
    }

    EVENTS {
        uuid id PK
        uuid msg_id UK "NULL si lo genera el backend"
        uuid unit_id FK
        uuid node_id FK "NULL en eventos a nivel unidad"
        enum kind
        enum severity
        double value
        double threshold
        timestamptz ts
        timestamptz acknowledged_at
        uuid acknowledged_by FK
    }

    COMMANDS {
        uuid id PK
        uuid cmd_id UK
        uuid target_node_id FK
        uuid issued_by_user_id FK
        enum issued_by_role "snapshot al emitir"
        enum action
        jsonb params
        enum status "sent|delivered|executed|rejected"
        timestamptz issued_at
        timestamptz sent_at
        timestamptz delivered_at
        timestamptz executed_at
        timestamptz rejected_at
    }

    COMMAND_LOG {
        uuid id PK
        uuid command_id FK
        uuid msg_id UK "ack que originó la fila"
        enum status
        timestamptz occurred_at
    }

    UNITS ||--o{ NODES : "tiene"
    UNITS |o--o| NODES : "active_node_id"
    NODES ||--o{ NODE_CAPABILITIES : "reporta"
    NODES ||--o{ TELEMETRY : "genera"
    UNITS ||--o{ EVENTS : "pertenece a"
    NODES |o--o{ EVENTS : "origina (opcional)"
    USERS |o--o{ EVENTS : "confirma"
    NODES ||--o{ COMMANDS : "recibe"
    USERS ||--o{ COMMANDS : "emite"
    COMMANDS ||--o{ COMMAND_LOG : "historial"
```

## Por qué estas tablas (y no otras)

- **`users` / `units` / `nodes` / `telemetry` / `events` / `commands` /
  `command_log`** son exactamente las "tablas mínimas" pedidas. No hay
  tabla de `heartbeats`: el heartbeat no se guarda como historial, solo
  actualiza el estado actual del nodo (`nodes.last_heartbeat_at`,
  `battery_pct`, `pending_outbox`, `sampling_ms`, `mode`, `is_online`).
  Si más adelante se necesita graficar batería/cola en el tiempo, se
  agrega una hypertable `heartbeats` en una migración nueva — no antes,
  para no cargar una tabla que nadie consulta todavía.
- **`node_capabilities`** es la única tabla que no aparece explícita en el
  plan: existe porque `capabilities: string[]` del heartbeat es un
  atributo multivaluado, y guardarlo como columna `text[]` en `nodes`
  rompería 1FN (grupo repetitivo dentro de una fila). Se normalizó a una
  tabla `(node_id, capability)`.
- **`commands` vs. `command_log`**: `commands` guarda el estado *actual*
  de cada comando (para `GET /commands` y la tabla de la vista
  "Comandos" del dashboard). `command_log` es la bitácora — una fila por
  cada transición de estado, incluyendo quién la originó y cuándo. Es lo
  que alimenta la vista "Bitácora".

## Normalización (3FN)

**1FN — valores atómicos, sin grupos repetitivos.**
`accel`/`gyro`/`gps` del contrato (objetos anidados) se descomponen en
columnas escalares (`accel_x`, `accel_y`, `accel_z`, ...) en vez de
guardarse como JSON. `capabilities` (arreglo) se normaliza a
`node_capabilities`, no a una columna `text[]`.

**2FN — sin dependencias parciales de una clave compuesta.**
Todas las tablas usan una PK de una sola columna (`id UUID`), así que no
hay atributo que dependa de "una parte" de la clave. La única PK
compuesta es `telemetry (id, ts)`, y es un requisito **físico** de
TimescaleDB (la columna de partición debe estar en toda PK/UNIQUE de una
hypertable) — `id` ya es único por sí solo (UUID generado en el insert),
`ts` no aporta una segunda dimensión de identidad de negocio. No es una
clave compuesta de negocio, es una restricción de la implementación de
particionado.

**3FN — sin dependencias transitivas.**
Ejemplos concretos de lo que se evitó:
- `telemetry`/`events` no guardan `unit_id` derivable de `node_id` — se
  llega a la unidad haciendo join con `nodes` (excepto en `events`, ver
  abajo).
- `nodes` no guarda el `label` ni el `unit_code` de la unidad — solo
  `unit_id` (FK); esos datos viven únicamente en `units`.
- `commands` no guarda el email ni los datos del usuario — solo
  `issued_by_user_id` (FK) más `issued_by_role`.

**Excepción documentada, no un descuido:** `events.unit_id` sí se guarda
explícito aunque en teoría podría derivarse de `node_id → nodes.unit_id`.
Se hace porque `node_id` es NULL en los eventos que genera el propio
backend a nivel unidad (`source_failover`, `sensor_disagreement` comparan
primary vs. backup, no pertenecen a un solo nodo) — en esos casos no hay
camino de join para obtener la unidad. Cuando `node_id` sí está presente,
`events.unit_id` debe coincidir con `nodes.unit_id` de ese nodo; esa
invariante se mantiene en la capa de aplicación (el caso de uso que
inserta el evento arma la fila completa), no con un trigger, para
mantener el esquema de la Fase 0 simple.

**`issued_by_role` en `commands`** tampoco es una violación de 3FN aunque
"parezca" redundante con `users.role`: es un snapshot histórico ("con qué
rol se autorizó este comando en su momento"), no el estado actual del
usuario, que puede cambiar de rol después sin que eso deba reescribir
comandos ya emitidos. Es un patrón estándar de bitácora/auditoría.

## Roles y autoridad

- `users.role` (`control_center` | `operator`) es la fuente de verdad del
  rol actual de un usuario — la usa el login/JWT.
- `nodes.role` (`primary` | `backup`) es un concepto distinto: el rol del
  *nodo* dentro de su unidad para efectos de failover, nada que ver con
  usuarios. `UNIQUE (unit_id, role)` garantiza que una unidad tenga como
  máximo un primary y un backup.
- La regla "operator solo puede trigger_alarm/stop_alarm" del contrato
  (`isActionAllowedForRole` en `contract.ts`) se aplica en la capa de
  aplicación antes de insertar en `commands`, no en el esquema — una
  tabla de permisos sería sobre-ingeniería para dos roles y seis acciones
  fijas.
