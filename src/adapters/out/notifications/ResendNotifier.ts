/* Envío de correo por Resend.
 *
 * Se habla con su API HTTP directamente en vez de con su SDK: es una
 * sola petición POST y añadir una dependencia para eso no se paga.
 *
 * Nunca lanza. Un aviso es un efecto secundario de una operación que ya
 * salió bien —el usuario entró, el cliente consultó su envío— y hacer
 * fallar esa operación porque el correo no salió sería peor que no
 * mandarlo. Los errores se devuelven para que quien llama los registre.
 */

import type {
  Notification,
  NotificationPort,
  NotificationResult,
} from "../../../domain/ports/NotificationPort.js";

/** Tope de espera. Resend responde en decenas de ms; si tarda más que
 *  esto algo va mal y no vale la pena hacer esperar a quien inició
 *  sesión. */
const TIMEOUT_MS = 8000;

export interface ResendConfig {
  apiKey: string;
  /** Remitente, con el formato "Nombre <correo@dominio>". El dominio
   *  debe estar verificado en Resend, salvo onboarding@resend.dev, que
   *  sirve para probar sin verificar nada. */
  from: string;
}

export class ResendNotifier implements NotificationPort {
  constructor(
    private readonly config: ResendConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(notification: Notification): Promise<NotificationResult> {
    try {
      const respuesta = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.config.from,
          to: [notification.to],
          subject: notification.subject,
          text: notification.text,
          ...(notification.html ? { html: notification.html } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!respuesta.ok) {
        // El cuerpo del error trae el motivo (dominio sin verificar,
        // clave inválida): se conserva porque es lo que hace falta para
        // arreglarlo, y no llega al usuario final.
        const detalle = await respuesta.text().catch(() => "");
        return {
          sent: false,
          error: `Resend respondió ${respuesta.status}: ${detalle.slice(0, 200)}`,
        };
      }

      const cuerpo = (await respuesta.json().catch(() => ({}))) as { id?: string };
      return { sent: true, ...(cuerpo.id ? { id: cuerpo.id } : {}) };
    } catch (err) {
      return {
        sent: false,
        error: err instanceof Error ? err.message : "Error desconocido al enviar",
      };
    }
  }
}
