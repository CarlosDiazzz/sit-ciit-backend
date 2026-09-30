# Gestión logística y administrativa

Implementación en `carlos-branch`. La aceptación manual del equipo precede a cualquier fusión a `main`.

## Módulos

`/management/resources` entrega los módulos, campos y permisos que consume el dashboard. Cada módulo usa tablas propias, claves foráneas y validación de campos en el servidor.

| Recurso de API | Uso |
| --- | --- |
| companies | Empresas, clientes y contactos |
| users | Cuentas, empresa y perfiles por rol |
| units | Unidades de transporte, matrícula, capacidad y estado |
| nodes | Edición administrativa de dispositivos |
| containers | Contenedores y capacidad |
| monitoring-profiles | Configuración deseada de adquisición y umbrales |
| cargo-types | Catálogo ampliable y perfil asociado |
| locations | Puertos, estaciones, terminales y almacenes |
| routes | Rutas versionadas, origen y destino |
| route-checkpoints | Escalas ordenadas por ruta |
| shipments | Mercancías, cliente, peso y estado |
| trips | Trayectos, unidad, ruta y fechas |
| trip-shipments | Manifiesto de carga, contenedor y entrega final |
| assignments | Personas asignadas con periodo de vigencia |
| incidents | Atención de incidentes y resolución |
| notification-rules | Destinatarios, canales y severidades |
| maintenance | Trabajos programados para técnicos y nodos |

Para cada recurso: `GET /management/{recurso}`, `GET /management/{recurso}/{id}`, `POST`, `PATCH /{id}` y `DELETE /{id}`. Listas paginadas: `page`, `limit` (máximo 100), `search` e `archived=true`. DELETE archiva: conserva relaciones e historial. PATCH con `active=true` reactiva registros cuando sus reglas lo permiten.

La identidad MQTT del nodo se aprovisiona con `POST /nodes`; genera un secreto mostrado una vez. No se cambia el código, unidad o rol de un nodo con historial. `POST /nodes/{id}/reactivate` genera un secreto nuevo y reactiva un dispositivo archivado. Rotación: `POST /nodes/{id}/regenerate-secret`. Los dispositivos y unidades inactivos no se autentican para ingesta.

## Roles

- Administrador: gestión general y de otros administradores.
- Centro de control: catálogos, personas, viajes, incidentes y comandos. No puede crear o modificar administradores.
- Operador: consulta de sus viajes y unidades durante asignaciones vigentes; incidentes y alarmas dentro de ese ámbito.
- Cliente: consulta de su empresa, envíos y trayectos asociados. No accede a telemetría cruda, usuarios, secretos ni comandos.
- Técnico: mantenimiento asignado y edición administrativa de los dispositivos correspondientes.
- Auditor: consulta y auditoría sin escritura ni comandos.

Cada petición verifica la cuenta y rol actuales en PostgreSQL; un token anterior no mantiene acceso tras una baja. Las emisiones Socket.IO también revalidan cuenta y ámbito. Los roles del protocolo MQTT siguen siendo control_center/operator; el administrador emite comandos con autoridad de control_center.

Los campos específicos de usuario se guardan en `user_profiles`: empleado, puesto, centro, turno, función de campo, contacto de emergencia, licencia y vigencia, especialidad, zona y preferencia de correo. Los clientes requieren empresa; los conductores identificados como tales requieren licencia.

## Reglas operativas

- Un viaje comienza planificado. Para iniciar necesita unidad disponible, personal con asignación vigente y envíos activos en estado listo.
- Se validan capacidades de unidad y contenedor y se impide usar una unidad, envío o contenedor en dos viajes simultáneos.
- Al iniciar, se conserva una copia de la ruta y sus escalas. Una edición posterior no reescribe esa copia.
- Iniciar y finalizar actualiza estados de unidad, contenedores y envíos en una transacción.
- Si `final_leg=false`, el envío vuelve a listo al cerrar ese tramo, permitiendo otro medio de transporte. Si es el último tramo, queda entregado.
- No se cambia la unidad o ruta de un viaje iniciado ni el manifiesto de un viaje en curso/cerrado.
- Cancelar requiere motivo. Los viajes deben finalizar o cancelarse antes de archivarlos.
- Incidentes: abierto → reconocido/en atención → resuelto/descartado; el cierre requiere motivo. Comentarios y enlaces de evidencia se conservan sin editar.
- Auditoría transaccional de cambios administrativos: actor, objeto, acción, antes/después y fecha. No contiene hashes ni contraseñas o secretos en texto plano.

## Perfiles y confirmaciones

`POST /management/monitoring-profiles/{id}/apply` con `{ "node_id": "UUID" }` envía los comandos compatibles de muestreo y umbral de impacto. Guarda versión/configuración deseada; `GET /management/monitoring-profiles/{id}/applications` muestra estados reales de los comandos y sus ACK. Emitir un comando no significa que el dispositivo lo ejecutó.

El nodo móvil actual no soporta activación individual remota de sensores ni todos los umbrales del perfil. Luz y límites ambientales internos se conservan como configuración deseada y se informa esa limitación. Los celulares no aportan temperatura/humedad internas reales; el clima Open-Meteo es contexto externo.

## Notificaciones y reportes

Los incidentes nuevos generan registros de disponibilidad de avisos del dashboard. Correo, Telegram y SMS quedan marcados `not_configured`: no hay adaptador externo que entregue esos mensajes todavía. Historial: `/management/notification-deliveries`. Cada destinatario consulta **Mis avisos** (`/management/my-notifications`), con filtros de empresa/asignación.

Reporte real por trayecto: `/management/reports/trips/{id}`. Incluye manifiesto visible según empresa, intervalo, conteo de lecturas, muestras recibidas con demora, velocidades almacenadas e incidentes por estado. Cero lecturas produce velocidades nulas, sin datos simulados. El reporte no calcula disponibilidad exacta: todavía no existe historial de heartbeat. La velocidad inercial no equivale a una medición GPS.

## Preparación y pruebas manuales

1. Infraestructura existente: Mosquitto y TimescaleDB activos.
2. Backend: `npm install`, `npm run migrate`, `npm run dev`.
3. Dashboard: `npm install`, `npm run dev`. Entrar a **Gestión logística**.
4. La cuenta control_center existente puede gestionar el sistema. Para una cuenta admin inicial: `npm run create-user -- tu-correo admin` y proporcionar la contraseña al script.
5. Crear empresa, ubicaciones, perfil, tipo de carga, unidad y contenedor.
6. Crear operador, técnico y cliente. Vincular el cliente con su empresa.
7. Registrar nodo en **Nodos**, copiar el secreto al celular y editar sus datos en Gestión → Dispositivos.
8. Crear ruta y escalas, envío listo y viaje planificado. Añadir manifiesto y asignación con inicio ya vigente.
9. Iniciar viaje: verificar estados, telemetría real del celular y comandos/ACK. Probar envío de perfil.
10. Abrir incidente, añadir evidencia, reconocerlo y cerrarlo con resolución.
11. Finalizar viaje y revisar reporte. Para probar varios tramos, desmarcar entrega final en el manifiesto del primer tramo.
12. Entrar como cliente: solo deben aparecer sus registros, sin botones de escritura. Entrar como operador: solo unidades/viajes asignados. Auditor no debe poder escribir.
13. Probar duplicados, fechas invertidas, carga excesiva y archivo de viajes en curso: deben rechazarse con explicación.
14. Archivar cuenta de prueba: no debe iniciar sesión ni conservar acceso con su token previo. Revisar auditoría y comprobar que los registros siguen existiendo.

## Pruebas automatizadas

Backend: `npm test`, `npm run typecheck`, `npm run build`.
Dashboard: `npm run build`, `npm run lint`, `npm run test:ui` (primera vez: `npx playwright install chromium`).

Las pruebas crean esquemas PostgreSQL temporales independientes y los eliminan al terminar. No generan telemetría en las tablas operativas. El navegador usa puertos 4310/4311 y credenciales exclusivas de fixtures.

La antigua landing pública usa su propio archivo de referencias y no constituye el portal autenticado de clientes. Su adaptador debe autenticarse antes de consultar las APIs ahora protegidas; este cambio incorpora el acceso de clientes en el dashboard (`/gestion`).

## Historial de lecturas por nodo

`GET /node-history/nodes` lista los dispositivos visibles para la cuenta,
incluyendo los archivados. `GET /node-history?nodeId=UUID&from=ISO&to=ISO&limit=100`
consulta un solo nodo. Los periodos pueden tener hasta 31 días; `limit` acepta
1–200. La respuesta incluye `items`, `nextCursor`, `hasMore` y `snapshot`.
Para páginas siguientes, enviar el cursor con los mismos filtros. Se ordena por
hora de captura e identificador y se conserva un corte por hora de recepción
para evitar que una sincronización posterior altere las páginas siguientes.

No requiere migraciones nuevas. La consulta usa la telemetría existente,
conserva ceros y valores ausentes y valida acceso a la unidad en cada petición.
Clientes no acceden a telemetría cruda; operadores/técnicos usan su ámbito de
asignación, y administradores/centro de control/auditores pueden consultar todos
los nodos. El historial no inventa batería ni conectividad: los heartbeats
actualmente guardan un estado reciente y no una serie histórica.
