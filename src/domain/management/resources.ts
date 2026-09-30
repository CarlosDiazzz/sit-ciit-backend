import { z } from "zod";
export type Role =
  | "admin"
  | "control_center"
  | "operator"
  | "cliente"
  | "technician"
  | "auditor";
export const managers: Role[] = ["admin", "control_center"];
export interface Field {
  key: string;
  label: string;
  type:
    | "text"
    | "textarea"
    | "email"
    | "number"
    | "select"
    | "reference"
    | "datetime"
    | "date"
    | "boolean"
    | "password";
  required?: boolean;
  options?: { value: string; label: string }[];
  resource?: string;
  min?: number;
  max?: number;
  roles?: Role[];
}
export interface Resource {
  table: string;
  label: string;
  fields: Field[];
  writeRoles: Role[];
  readRoles: Role[];
}
const all: Role[] = [
  "admin",
  "control_center",
  "operator",
  "cliente",
  "technician",
  "auditor",
];
const staff: Role[] = [
  "admin",
  "control_center",
  "operator",
  "technician",
  "auditor",
];
const text = (key: string, label: string, required = false): Field => ({
  key,
  label,
  type: "text",
  required,
});
const long = (key: string, label: string, required = false): Field => ({
  key,
  label,
  type: "textarea",
  required,
});
const ref = (
  key: string,
  label: string,
  resource: string,
  required = false,
): Field => ({ key, label, type: "reference", resource, required });
const num = (
  key: string,
  label: string,
  min?: number,
  max?: number,
  required = false,
): Field => ({ key, label, type: "number", min, max, required });
const select = (
  key: string,
  label: string,
  values: string[],
  labels: string[],
  required = true,
): Field => ({
  key,
  label,
  type: "select",
  required,
  options: values.map((value, i) => ({ value, label: labels[i]! })),
});
const date = (key: string, label: string, required = false): Field => ({
  key,
  label,
  type: "datetime",
  required,
});
const flag = (key: string, label: string): Field => ({
  key,
  label,
  type: "boolean",
});
const identity = [
  text("code", "Código / folio", true),
  text("name", "Nombre", true),
];
const base = (
  table: string,
  label: string,
  fields: Field[],
  writeRoles: Role[] = managers,
  readRoles: Role[] = staff,
): Resource => ({ table, label, fields, writeRoles, readRoles });
export const resources: Record<string, Resource> = {
  companies: base(
    "companies",
    "Empresas y clientes",
    [
      ...identity,
      text("legal_name", "Razón social"),
      text("tax_id", "RFC"),
      text("contact_name", "Contacto"),
      { key: "email", label: "Correo", type: "email" },
      text("phone", "Teléfono"),
      long("address", "Domicilio"),
    ],
    managers,
    ["admin", "control_center", "auditor", "cliente"],
  ),
  users: base(
    "users",
    "Usuarios",
    [
      { key: "email", label: "Correo", type: "email", required: true },
      {
        key: "password",
        label: "Contraseña (mínimo 8 caracteres)",
        type: "password",
      },
      text("first_name", "Nombre", true),
      text("last_name", "Apellidos", true),
      text("phone", "Teléfono"),
      select(
        "role",
        "Rol",
        [
          "admin",
          "control_center",
          "operator",
          "cliente",
          "technician",
          "auditor",
        ],
        [
          "Administrador",
          "Centro de control",
          "Operador",
          "Cliente",
          "Técnico",
          "Auditor",
        ],
      ),
      ref("company_id", "Empresa", "companies"),
      text("employee_number", "Número de empleado"),
      text("job_title", "Puesto"),
      {
        ...text("operating_center", "Centro operativo"),
        roles: ["control_center", "admin", "auditor"],
      },
      { ...text("shift", "Turno"), roles: ["control_center", "operator"] },
      {
        ...select(
          "field_function",
          "Función en campo",
          ["driver", "custodian"],
          ["Conductor", "Custodio"],
          false,
        ),
        roles: ["operator"],
      },
      {
        ...text("emergency_contact", "Contacto de emergencia"),
        roles: ["operator"],
      },
      { ...text("license_number", "Número de licencia"), roles: ["operator"] },
      {
        key: "license_expires_on",
        label: "Vigencia de licencia",
        type: "date",
        roles: ["operator"],
      },
      { ...text("specialty", "Especialidad"), roles: ["technician"] },
      {
        ...text("service_zone", "Zona / ámbito"),
        roles: ["technician", "auditor"],
      },
      {
        ...flag("notification_email", "Recibir avisos por correo"),
        roles: ["cliente"],
      },
    ],
    managers,
    ["admin", "control_center", "auditor"],
  ),
  units: base("units", "Unidades", [
    text("unit_code", "Código de unidad", true),
    text("label", "Nombre"),
    ref("company_id", "Empresa responsable", "companies"),
    select(
      "transport_type",
      "Medio",
      ["vagon", "camion", "otro"],
      ["Vagón", "Camión", "Otro"],
    ),
    text("registration", "Matrícula"),
    num("capacity_kg", "Capacidad (kg)", 0.001),
    select(
      "status",
      "Estado",
      ["available", "in_transit", "maintenance", "retired"],
      ["Disponible", "En tránsito", "Mantenimiento", "Retirada"],
    ),
  ]),
  nodes: base(
    "nodes",
    "Dispositivos",
    [
      text("label", "Nombre"),
      text("model", "Modelo"),
      select(
        "device_type",
        "Tipo",
        ["phone", "esp32", "other"],
        ["Celular", "ESP32", "Otro"],
      ),
      text("firmware_version", "Versión de app / firmware"),
    ],
    ["admin", "control_center", "technician"],
  ),
  containers: base("containers", "Contenedores", [
    ...identity,
    select(
      "container_type",
      "Tipo",
      ["standard", "refrigerated", "tank", "other"],
      ["Estándar", "Refrigerado", "Tanque", "Otro"],
    ),
    num("capacity_kg", "Capacidad (kg)", 0.001),
    ref("company_id", "Propietario", "companies"),
    select(
      "status",
      "Estado",
      ["available", "in_use", "maintenance", "retired"],
      ["Disponible", "En uso", "Mantenimiento", "Retirado"],
    ),
  ]),
  "monitoring-profiles": base("monitoring_profiles", "Perfiles de monitoreo", [
    ...identity,
    long("description", "Descripción"),
    num("sampling_ms", "Muestreo (ms)", 100, 60000, true),
    num("impact_threshold_g", "Umbral de impacto (g)", 0.001),
    num("light_threshold_lux", "Umbral de luz (lux)", 0),
    num("min_temperature_c", "Temperatura mínima interna (°C)"),
    num("max_temperature_c", "Temperatura máxima interna (°C)"),
    num("max_humidity_pct", "Humedad interna máxima (%)", 0, 100),
    flag("accelerometer_enabled", "Acelerómetro"),
    flag("gyroscope_enabled", "Giroscopio"),
    flag("gps_enabled", "GPS"),
    flag("light_enabled", "Luz"),
  ]),
  "cargo-types": base("cargo_types", "Tipos de carga", [
    ...identity,
    long("description", "Descripción"),
    long("handling_requirements", "Requisitos de manejo"),
    ref("monitoring_profile_id", "Perfil de monitoreo", "monitoring-profiles"),
    select(
      "weather_category",
      "Categoría para riesgo climático",
      ["agricola", "construccion", "quimico", "sin_carga"],
      ["Agrícola", "Construcción", "Químicos", "Sin carga"],
      false,
    ),
  ]),
  locations: base("locations", "Ubicaciones", [
    ...identity,
    select(
      "location_type",
      "Tipo",
      ["port", "terminal", "station", "warehouse", "other"],
      ["Puerto", "Terminal", "Estación", "Almacén", "Otro"],
    ),
    num("latitude", "Latitud", -90, 90, true),
    num("longitude", "Longitud", -180, 180, true),
    long("address", "Dirección"),
  ]),
  routes: base("routes", "Rutas", [
    ...identity,
    ref("origin_id", "Origen", "locations", true),
    ref("destination_id", "Destino", "locations", true),
    num("distance_km", "Distancia (km)", 0.001),
    long("description", "Descripción del recorrido"),
  ]),
  "route-checkpoints": base(
    "route_checkpoints",
    "Escalas y puntos de control",
    [
      ref("route_id", "Ruta", "routes", true),
      ref("location_id", "Ubicación", "locations", true),
      num("position", "Orden en el recorrido", 1, 9999, true),
    ],
  ),
  shipments: base(
    "shipments",
    "Envíos",
    [
      ...identity,
      ref("company_id", "Cliente", "companies", true),
      ref("cargo_type_id", "Tipo de carga", "cargo-types", true),
      ref("origin_id", "Origen", "locations", true),
      ref("destination_id", "Destino", "locations", true),
      num("weight_kg", "Peso (kg)", 0.001, undefined, true),
      long("description", "Descripción de mercancía"),
      date("planned_departure", "Salida prevista"),
      date("planned_arrival", "Llegada prevista"),
      select(
        "status",
        "Estado",
        ["draft", "ready", "in_transit", "delivered", "cancelled"],
        ["Borrador", "Listo", "En tránsito", "Entregado", "Cancelado"],
      ),
      long("cancellation_reason", "Motivo de cancelación"),
    ],
    managers,
    all,
  ),
  trips: base(
    "trips",
    "Viajes",
    [
      ...identity,
      ref("route_id", "Ruta", "routes", true),
      ref("unit_id", "Unidad", "units", true),
      date("planned_departure", "Salida prevista", true),
      date("planned_arrival", "Llegada prevista", true),
      select(
        "status",
        "Estado",
        ["planned", "in_transit", "completed", "cancelled"],
        ["Planificado", "En tránsito", "Finalizado", "Cancelado"],
      ),
      long("cancellation_reason", "Motivo de cancelación"),
    ],
    managers,
    all,
  ),
  "trip-shipments": base(
    "trip_shipments",
    "Carga por viaje",
    [
      ref("trip_id", "Viaje", "trips", true),
      ref("shipment_id", "Envío", "shipments", true),
      ref("container_id", "Contenedor", "containers"),
      flag("final_leg", "Último tramo del envío (entrega final)"),
    ],
    managers,
    all,
  ),
  assignments: base(
    "assignments",
    "Asignaciones",
    [
      ref("user_id", "Persona", "users", true),
      ref("trip_id", "Viaje", "trips", true),
      select(
        "function",
        "Función",
        ["driver", "custodian", "supervisor", "technician"],
        ["Conductor", "Custodio", "Supervisor", "Técnico"],
      ),
      date("starts_at", "Inicio", true),
      date("ends_at", "Fin"),
    ],
    managers,
    staff,
  ),
  incidents: base(
    "incidents",
    "Incidentes",
    [
      ...identity,
      ref("unit_id", "Unidad", "units", true),
      ref("trip_id", "Viaje", "trips"),
      ref("event_id", "Evento de origen", "events"),
      ref("assigned_to", "Responsable", "users"),
      select(
        "severity",
        "Severidad",
        ["info", "warning", "critical"],
        ["Información", "Advertencia", "Crítico"],
      ),
      long("description", "Descripción", true),
      select(
        "status",
        "Estado",
        ["open", "acknowledged", "in_progress", "resolved", "dismissed"],
        ["Abierto", "Reconocido", "En atención", "Resuelto", "Descartado"],
      ),
      long("resolution", "Resolución / motivo"),
    ],
    ["admin", "control_center", "operator"],
    staff,
  ),
  "notification-rules": base("notification_rules", "Notificaciones", [
    ...identity,
    ref("user_id", "Destinatario", "users", true),
    select(
      "severity",
      "Severidad mínima",
      ["info", "warning", "critical"],
      ["Información", "Advertencia", "Crítico"],
    ),
    select(
      "channel",
      "Canal",
      ["dashboard", "email", "telegram", "sms"],
      [
        "Dashboard",
        "Correo (pendiente de integración)",
        "Telegram (pendiente de integración)",
        "SMS (pendiente de integración)",
      ],
    ),
    text("destination", "Correo, teléfono o identificador"),
  ]),
  maintenance: base(
    "maintenance",
    "Mantenimiento",
    [
      ...identity,
      ref("node_id", "Dispositivo", "nodes", true),
      ref("technician_id", "Técnico", "users", true),
      date("scheduled_at", "Fecha programada", true),
      long("description", "Trabajo requerido", true),
      select(
        "status",
        "Estado",
        ["scheduled", "in_progress", "completed", "cancelled"],
        ["Programado", "En curso", "Finalizado", "Cancelado"],
      ),
      long("result", "Resultado"),
    ],
    ["admin", "control_center", "technician"],
  ),
};
export const profileKeys = [
  "employee_number",
  "job_title",
  "operating_center",
  "shift",
  "field_function",
  "emergency_contact",
  "license_number",
  "license_expires_on",
  "specialty",
  "service_zone",
  "notification_email",
];
export function bodySchema(resource: Resource, partial = false) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of resource.fields) {
    let rule: z.ZodTypeAny;
    if (field.type === "number") {
      let n = z.number().finite();
      if (field.min !== undefined) n = n.min(field.min);
      if (field.max !== undefined) n = n.max(field.max);
      if (["sampling_ms", "position"].includes(field.key)) n = n.int();
      rule = n;
    } else if (field.type === "boolean") rule = z.boolean();
    else if (field.type === "reference") rule = z.string().uuid();
    else if (field.type === "select")
      rule = z.enum(
        field.options!.map((o) => o.value) as [string, ...string[]],
      );
    else if (field.type === "datetime")
      rule = z.string().datetime({ offset: true });
    else if (field.type === "date")
      rule = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    else if (field.type === "email")
      rule = z
        .string()
        .trim()
        .email()
        .max(254)
        .transform((s) => s.toLowerCase());
    else if (field.type === "password") rule = z.string().min(8).max(128);
    else
      rule = z
        .string()
        .trim()
        .min(1)
        .max(field.type === "textarea" ? 10000 : 250);
    shape[field.key] = field.required
      ? partial
        ? rule.optional()
        : rule
      : rule.nullable().optional();
  }
  shape.active = z.boolean().optional();
  return z.object(shape).strict();
}
