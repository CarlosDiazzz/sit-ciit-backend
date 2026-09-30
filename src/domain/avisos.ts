/* Redacción de los avisos por correo.
 *
 * Separado del envío a propósito: componer el texto es una decisión de
 * dominio —qué se le dice al cliente y con qué palabras— y se puede
 * probar sin tocar la red ni un proveedor.
 *
 * Criterio de redacción: el asunto dice qué pasó y con qué referencia,
 * porque en una bandeja llena eso es lo único que se lee. El cuerpo no
 * repite el asunto y no pide disculpas por existir.
 */

export interface AvisoSesion {
  email: string;
  /** Hora del inicio de sesión, en el reloj del servidor. */
  cuando: Date;
  /** Nombre de la empresa cuando el usuario es un cliente. */
  empresa?: string | null;
}

export interface AvisoConsulta {
  email: string;
  referencia: string;
  /** Descripción de la carga, tal como está declarada en el envío. */
  descripcion: string | null;
  origen: string | null;
  destino: string | null;
  /** "reporting" si hay un nodo publicando ahora; "waiting" si el viaje
   *  existe pero todavía no hay telemetría. */
  estado: "reporting" | "waiting";
  /** Último dato recibido de la unidad que lleva este envío. */
  ultimoReporte: Date | null;
  cuando: Date;
}

const ZONA = "America/Mexico_City";

/** Fecha y hora legibles, en la zona del corredor. Un cliente en
 *  Coatzacoalcos no debe tener que convertir UTC mentalmente. */
function momento(d: Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: ZONA,
  }).format(d);
}

/** Cuánto hace, en palabras. Para el último reporte: "hace 4 minutos"
 *  se entiende más rápido que una marca de tiempo. */
function hace(desde: Date, hasta: Date): string {
  const minutos = Math.floor((hasta.getTime() - desde.getTime()) / 60000);
  if (minutos < 1) return "hace menos de un minuto";
  if (minutos === 1) return "hace un minuto";
  if (minutos < 60) return `hace ${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  if (horas === 1) return "hace una hora";
  if (horas < 24) return `hace ${horas} horas`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "hace un día" : `hace ${dias} días`;
}

export function avisoDeSesion(a: AvisoSesion): { subject: string; text: string } {
  const quien = a.empresa ? `${a.empresa} (${a.email})` : a.email;
  return {
    subject: "Inicio de sesión en SIT-CIIT",
    text: [
      `Se inició sesión en tu cuenta de SIT-CIIT.`,
      "",
      `Cuenta:  ${quien}`,
      `Momento: ${momento(a.cuando)}`,
      "",
      // Sin este cierre el aviso solo informa; con él, sirve para algo.
      "Si no fuiste tú, avisa al centro de control para que revoquen el acceso.",
      "",
      "SIT-CIIT · Corredor Interoceánico del Istmo de Tehuantepec",
    ].join("\n"),
  };
}

export function avisoDeConsulta(a: AvisoConsulta): { subject: string; text: string } {
  const ruta =
    a.origen && a.destino ? `${a.origen} → ${a.destino}` : (a.origen ?? a.destino ?? null);

  const estado =
    a.estado === "reporting"
      ? a.ultimoReporte
        ? `En tránsito. Último reporte ${hace(a.ultimoReporte, a.cuando)}.`
        : "En tránsito."
      : // No decir "sin datos" a secas: un cliente lo lee como avería.
        "Todavía sin reportes de la unidad. En cuanto el nodo publique, el seguimiento se activa.";

  return {
    subject: `Estado de tu envío ${a.referencia}`,
    text: [
      // Sin punto final: el formato de es-MX ya termina en "p.m.".
      `Consulta realizada el ${momento(a.cuando)}`,
      "",
      `Referencia: ${a.referencia}`,
      ...(a.descripcion ? [`Carga:      ${a.descripcion}`] : []),
      ...(ruta ? [`Ruta:       ${ruta}`] : []),
      "",
      estado,
      "",
      "Consulta el detalle y la posición en el portal de seguimiento.",
      "",
      "SIT-CIIT · Corredor Interoceánico del Istmo de Tehuantepec",
    ].join("\n"),
  };
}
