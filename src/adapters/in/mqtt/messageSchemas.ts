import { z } from "zod";

// Espejo en Zod de contract.ts / contract.schema.json (v1.0.0), acotado a
// los mensajes que este suscriptor procesa. Si el contrato sube de
// versión, actualizar aquí también.

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
  contractVersion: z.literal("1.0.0"),
  msgId: z.string().uuid(),
  nodeId: z.string().min(1),
  unitId: z.string().min(1),
  role: z.enum(["primary", "backup"]),
  seq: z.number().int().min(0),
  ts: z.number().int().min(0),
  type: z.literal("telemetry"),
  accel: vector3Schema.optional(),
  gyro: vector3Schema.optional(),
  lux: z.number().optional(),
  pressureHpa: z.number().optional(),
  gps: gpsReadingSchema.optional(),
});

export type ValidatedTelemetryMessage = z.infer<typeof telemetryMessageSchema>;

export const heartbeatMessageSchema = z.object({
  contractVersion: z.literal("1.0.0"),
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
