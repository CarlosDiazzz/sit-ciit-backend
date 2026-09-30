-- Antes, cualquier mensaje con un nodeId nuevo se auto-registraba
-- (ON CONFLICT DO UPDATE en ensureNode.ts / PgNodeStateRepository) — no
-- había forma de distinguir un nodo real de alguien que solo escribió un
-- nodeId en un campo de texto. Un nodo ahora debe darse de alta
-- explícitamente (CRUD de Nodos, rol control_center), que genera este
-- secreto una sola vez; a partir de aquí cada mensaje debe traerlo
-- (contrato v1.3.0) y el backend lo verifica contra el hash antes de
-- aceptar nada.
--
-- Nullable por compatibilidad de columna, pero la verificación trata
-- NULL como rechazo, no como "sin verificar".

ALTER TABLE nodes ADD COLUMN secret_hash TEXT;
