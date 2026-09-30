export interface CellTower {
  lat: number;
  lon: number;
  radio: string | null;
  /** Metros, real de OpenCelliD para esa torre — null si no la trae. */
  rangeM: number | null;
  mcc: number | null;
  mnc: number | null;
  samples: number | null;
}

export interface Punto {
  lat: number;
  lon: number;
}

/** Fuente externa de antenas reales (OpenCelliD). Puerto separado del de
 *  persistencia, mismo principio que WeatherPort/WeatherRepository: uno
 *  habla con el mundo exterior, el otro con la base de datos.
 *
 *  Recibe puntos, no un bbox grande: el free tier de OpenCelliD limita
 *  cada consulta a 4,000,000 m² (~2x2 km, error real "BBOX too big"
 *  verificado en vivo) — el corredor completo (~250x130 km) no entra en
 *  una sola llamada. Se consulta un mosaico de celdas pequeñas
 *  centradas en los puntos reales de la ruta. */
export interface CellTowerPort {
  fetchNear(puntos: Punto[]): Promise<CellTower[]>;
}
