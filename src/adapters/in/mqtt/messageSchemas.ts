import { z } from "zod";

// Espejo en Zod de contract.ts / contract.schema.json (v1.1.0), acotado a
// los mensajes que este suscriptor procesa. Si el contrato sube de
// versión, actualizar aquí también.

// Cualquier 1.x.x, no el literal exacto de la versión actual: un bump de
// minor debe ser compatible con clientes que sigan en una versión
// anterior de 1.x (ver CHANGELOG.md del contrato).
const contractVersionSchema = z.string().regex(/^1\.\d+\.\d+$/, "contractVersion debe ser 1.x.x");

const vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const gpsReadingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  speedMs: z.number().min(0).optional(),
  accuracyM: z.number().min(0).optional(),
});

export const telemetryMessageSchema = z.object({
  contractVersion: contractVersionSchema,
  msgId: z.string().uuid(),
  nodeId: z.string().min(1),
  unitId: z.string().min(1),
  role: z.enum(["primary", "backup"]),
  seq: z.number().int().min(0),
  ts: z.number().int().min(0),
  type: z.literal("telemetry"),
  accel: vector3Schema.optional(),
  gyro: vector3Schema.optional(),
  // Lectura cruda en µT, no un rumbo/brújula (v1.1.0 del contrato).
  mag: vector3Schema.optional(),
  lux: z.number().optional(),
  pressureHpa: z.number().optional(),
  gps: gpsReadingSchema.optional(),
});

export type ValidatedTelemetryMessage = z.infer<typeof telemetryMessageSchema>;

export const heartbeatMessageSchema = z.object({
  contractVersion: contractVersionSchema,
  msgId: z.string().uuid(),
  nodeId: z.string().min(1),
  unitId: z.string().min(1),
  role: z.enum(["primary", "backup"]),
  seq: z.number().int().min(0),
  ts: z.number().int().min(0),
  type: z.literal("heartbeat"),
  batteryPct: z.number().min(0).max(100).optional(),
  pendingOutbox: z.number().int().min(0),
  samplingMs: z.number().int().min(0),
  capabilities: z.array(z.string()),
  mode: z.enum(["normal", "inspection", "alarm"]),
});

export type ValidatedHeartbeatMessage = z.infer<typeof heartbeatMessageSchema>;

const gpsCoordsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const eventMessageSchema = z.object({
  contractVersion: contractVersionSchema,
  msgId: z.string().uuid(),
  nodeId: z.string().min(1),
  unitId: z.string().min(1),
  role: z.enum(["primary", "backup"]),
  seq: z.number().int().min(0),
  ts: z.number().int().min(0),
  type: z.literal("event"),
  kind: z.enum(["impact", "door_open", "door_closed", "rollover", "threshold_exceeded"]),
  severity: z.enum(["info", "warning", "critical"]),
  value: z.number().optional(),
  threshold: z.number().optional(),
  gps: gpsCoordsSchema.optional(),
});

export type ValidatedEventMessage = z.infer<typeof eventMessageSchema>;
