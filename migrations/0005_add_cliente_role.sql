-- Rol para los dueños de la carga (agrícola/construcción/químico). No
-- entra al contrato MQTT (IssuerRole): un cliente nunca emite comandos a
-- un nodo, así que no pertenece al tipo que describe eso — es un
-- concepto de autorización del backend/dashboard, no del dispositivo.
--
-- En su propia migración: Postgres no permite usar un valor de enum
-- recién agregado en la misma transacción que lo agrega, y el runner
-- aplica cada archivo como una sola transacción (scripts/migrate.ts).

ALTER TYPE user_role ADD VALUE 'cliente';
