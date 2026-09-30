import type { CmdMessage } from "../../contract/contract.js";

/** Publica comandos hacia el nodo. El transporte (MQTT) es un detalle
 *  del adaptador: el dominio solo sabe que el comando sale. */
export interface CommandPublisher {
  publish(cmd: CmdMessage): Promise<void>;
}
