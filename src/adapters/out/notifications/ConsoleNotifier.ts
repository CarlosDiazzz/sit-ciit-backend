/* Avisos por consola, para desarrollo.
 *
 * Deja ver el correo completo —destinatario, asunto y cuerpo— sin
 * configurar un proveedor ni mandar nada a internet. Es el adaptador
 * por defecto cuando no hay RESEND_API_KEY, de modo que levantar el
 * backend sin credenciales no rompe el flujo: los avisos se registran
 * en vez de enviarse.
 */

import type {
  Notification,
  NotificationPort,
  NotificationResult,
} from "../../../domain/ports/NotificationPort.js";

export class ConsoleNotifier implements NotificationPort {
  constructor(private readonly log: (msg: string) => void = console.log) {}

  async send(notification: Notification): Promise<NotificationResult> {
    this.log(
      [
        "",
        "─── aviso por correo (no enviado: modo consola) ───",
        `para:   ${notification.to}`,
        `asunto: ${notification.subject}`,
        "",
        notification.text,
        "───────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return { sent: true };
  }
}
