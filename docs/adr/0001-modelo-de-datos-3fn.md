# ADR 0001 — Modelo de datos normalizado a 3FN, sin ORM

**Estado:** Aceptado

## Contexto

El plan pide explícitamente "pg con migraciones SQL" (no un ORM) y un
esquema normalizado que distinga roles de usuario (`control_center`/
`operator`) de roles de nodo (`primary`/`backup`), con bitácora de
comandos y series de tiempo de telemetría de alto volumen.

## Decisión

- SQL plano en `migrations/*.sql`, aplicado con un runner propio de ~50
  líneas (`scripts/migrate.ts`, usa `pg` directo) que registra lo
  aplicado en `schema_migrations`. Sin `node-pg-migrate`/Prisma/Drizzle:
  para un hackatón con un puñado de migraciones, una dependencia menos
  que aprender/depurar vale más que el azúcar sintáctico de un ORM.
- Enums nativos de Postgres (`user_role`, `node_role`, `event_kind`,
  etc.) en vez de columnas `TEXT` con `CHECK`, para que valores inválidos
  fallen al insertar, no en tiempo de lectura en la aplicación.
- Esquema normalizado a 3FN — detalle completo y justificación
  caso por caso en `docs/schema.md`.
- `commands` (estado actual) separado de `command_log` (historial
  completo de transiciones) — evita que "el último estado" y "toda la
  bitácora" compitan por la misma forma de tabla.

## Consecuencias

- (+) El esquema es legible directamente en SQL, sin indirección de un
  ORM — útil para depurar en `psql` durante la demo.
- (+) 3FN reduce el riesgo de que `nodes`/`events`/`commands` queden
  desincronizados entre sí (un solo lugar de verdad por dato).
- (+) `telemetry` como hypertable soporta el volumen esperado (hasta
  1 muestra/s por nodo) sin particionado manual.
- (-) Sin ORM, los adaptadores de Postgres (Fase 1+) escriben SQL a mano
  con `pg` — más verboso que un query builder, aceptado como costo del
  punto anterior.
- (-) `telemetry (id, ts)` como PK compuesta es, en rigor, un requisito
  físico de TimescaleDB más que una clave de negocio; documentado en
  `docs/schema.md` para que no se lea como una violación de 2FN pasada
  por alto.
