import type { MqttClient } from "mqtt";
import type { FastifyBaseLogger } from "fastify";

import type { CommandRepository } from "../../../domain/ports/CommandRepository.js";
import type { StatusBroadcaster } from "../../../domain/ports/TelemetryBroadcaster.js";
import type { VerifyNodeSecret } from "../../../application/verifyNodeSecret.js";
import { ackMessageSchema } from "./messageSchemas.js";

const ACK_TOPIC_FILTER = "sitciit/+/ack";

/**
 * Confirmaciones del nodo: mueven el comando por sent → delivered →
 * executed/rejected. Se engancha al cliente MQTT existente (un solo
 * clientId por proceso, ADR 0002).
 */
export function attachAckSubscriber(
  client: MqttClient,
  commands: CommandRepository,
  broadcaster: StatusBroadcaster,
  verifyNodeSecret: VerifyNodeSecret,
  logger: FastifyBaseLogger
): void {
  function subscribe() {
    client.subscribe(ACK_TOPIC_FILTER, { qos: 1 }, (err) => {
      if (err) logger.error({ err }, "mqtt: fallo al suscribirse a ack");
      else logger.info("mqtt: suscrito a %s", ACK_TOPIC_FILTER);
    });
  }

  if (client.connected) subscribe();
  client.on("connect", subscribe);

  client.on("message", (topic, payload) => {
    if (!topic.endsWith("/ack")) return;
    void handle(topic, payload);
  });

  async function handle(topic: string, payload: Buffer) {
    let json: unknown;
    try {
      json = JSON.parse(payload.toString("utf-8"));
    } catch {
      logger.warn({ topic }, "mqtt: ack no es JSON válido, descartado");
      return;
    }

    const parsed = ackMessageSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn(
        { topic, issues: parsed.error.issues },
        "mqtt: ack no cumple el contrato, descartado"
      );
      return;
    }

    const ack = parsed.data;

    const okSecret = await verifyNodeSecret(ack.nodeId, ack.nodeSecret);
    if (!okSecret) {
      logger.warn({ topic, nodeId: ack.nodeId }, "mqtt: secreto de nodo inválido, descartado");
      return;
    }

    try {
      const result = await commands.applyAck({
        cmdId: ack.cmdId,
        msgId: ack.msgId,
        status: ack.status,
        reason: ack.reason,
        occurredAt: new Date(ack.ts),
      });

      if (result.unknownCommand) {
        // Puede pasar legítimamente: un nodo que guardó un comando en su
        // outbox y lo confirma tras un reinicio del backend con base nueva.
        logger.warn({ cmdId: ack.cmdId }, "mqtt: ack de un comando desconocido");
        return;
      }
      if (!result.applied) return; // ack duplicado, nada que hacer

      logger.info(
        { cmdId: ack.cmdId, status: ack.status, node: ack.nodeId },
        "commands: ack aplicado"
      );
      broadcaster.commandUpdate({
        cmdId: ack.cmdId,
        nodeId: ack.nodeId,
        status: ack.status,
        reason: ack.reason ?? null,
        occurredAt: ack.ts,
      });
    } catch (err) {
      logger.error({ topic, err }, "mqtt: error aplicando ack");
    }
  }
}
