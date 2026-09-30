import type { NodeCredentialRepository } from "../domain/ports/NodeCredentialRepository.js";

export type VerifyNodeSecret = (nodeCode: string, secret: string) => Promise<boolean>;

/**
 * Puerta de entrada para todo mensaje que llega por MQTT (telemetry,
 * heartbeat, event, ack): sin esto, cualquiera podía declararse dueño de
 * cualquier nodeId con solo escribirlo. Se llama en cada suscriptor,
 * justo después de que el Zod schema valide la forma del mensaje y antes
 * de tocar cualquier caso de uso de ingesta.
 */
export function makeVerifyNodeSecret(repo: NodeCredentialRepository): VerifyNodeSecret {
  return (nodeCode, secret) => repo.verifySecret(nodeCode, secret);
}
