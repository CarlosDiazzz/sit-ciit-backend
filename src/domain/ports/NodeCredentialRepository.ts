/** Identidad de un nodo — separado de NodeStateRepository (que es sobre
 *  liveness/heartbeat) y del viejo ensureNode (que este puerto reemplaza).
 *  Un nodo solo existe si alguien con rol control_center lo dio de alta
 *  aquí; ya no se auto-registra con el primer mensaje que llegue. */
export interface NodeCredential {
  id: string;
  nodeCode: string;
  unitCode: string;
  role: "primary" | "backup";
  /** No expone el secreto — solo si tiene uno asignado. */
  hasSecret: boolean;
  isOnline: boolean;
  active: boolean;
  createdAt: Date;
}

export interface NodeCredentialRepository {
  /** Da de alta unit/node si no existen y genera un secreto nuevo. A
   *  diferencia del viejo auto-registro, esto lo dispara una acción
   *  explícita de control_center, no un mensaje MQTT sin verificar. */
  create(
    nodeCode: string,
    unitCode: string,
    role: "primary" | "backup",
  ): Promise<{ node: NodeCredential; secret: string }>;
  listAll(): Promise<NodeCredential[]>;
  /** null si el nodo no existe. */
  regenerateSecret(id: string): Promise<string | null>;
  delete(id: string): Promise<boolean>;
  /** true si el secreto coincide con el hash guardado para ese nodeCode.
   *  false también si el nodo no existe o no tiene secreto asignado —
   *  nunca se distingue el motivo, para no darle pistas a quien intenta
   *  adivinar. */
  verifySecret(nodeCode: string, secret: string): Promise<boolean>;
  /** Reemplaza a ensureNode: el nodo YA debe existir (su secreto se
   *  verificó antes de llegar aquí) — solo resuelve su UUID. null si por
   *  alguna razón ya no existe (se borró entre la verificación y este
   *  punto). */
  findIdByCode(nodeCode: string): Promise<string | null>;
}
