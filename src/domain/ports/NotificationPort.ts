/* Envío de avisos por correo.
 *
 * Puerto, no implementación: el dominio decide QUÉ se avisa y a quién,
 * y un adaptador de salida decide CÓMO se manda. Hoy hay dos —Resend
 * para correo real y uno de consola para desarrollo— y cambiar de
 * proveedor no toca ni una línea de la lógica de negocio.
 *
 * Por qué importa aquí: un aviso que falla no puede tumbar la operación
 * que lo originó. Si el correo de inicio de sesión no sale, el usuario
 * igual tiene que poder entrar. Por eso `send` nunca lanza: devuelve si
 * pudo o no, y quien llama decide (normalmente, registrarlo y seguir).
 */

export interface Notification {
  /** Destinatario. Una sola dirección: los avisos de este sistema son
   *  personales, no boletines. */
  to: string;
  subject: string;
  /** Cuerpo en texto plano. Obligatorio aunque haya HTML: hay clientes
   *  de correo que no lo muestran, y en logística se leen desde
   *  cualquier cosa. */
  text: string;
  /** Cuerpo en HTML, opcional. */
  html?: string;
}

export interface NotificationResult {
  sent: boolean;
  /** Id del proveedor cuando lo hay, para rastrear un envío concreto. */
  id?: string;
  /** Por qué no salió. Se registra, no se muestra al usuario final:
   *  puede traer detalles del proveedor. */
  error?: string;
}

export interface NotificationPort {
  send(notification: Notification): Promise<NotificationResult>;
}
