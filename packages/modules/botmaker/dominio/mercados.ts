/**
 * Mercados de BotMaker: los países donde se arman bots. Las reglas de cada país son configuración, no código repartido
 * por las pantallas: se suman acá (y, más adelante, la lista de datos sensibles y la veda de cada uno).
 */
export interface Mercado {
  iso: string;
  nombre: string;
  zonaHoraria: string;
  /** Modismos que el intérprete tiene que entender (van en sus instrucciones). */
  modismos: string;
}

export const MERCADOS: readonly Mercado[] = [
  {
    iso: 'PA', nombre: 'Panamá', zonaHoraria: 'America/Panama',
    modismos: '"xopá" es un saludo, "fren" es amigo, "chantin" es casa, "chen chen" es dinero, "camarón" es un trabajo ocasional, "pelao" es niño o muchacho, "el man" o "el lic" suele referirse al candidato.',
  },
  {
    iso: 'UY', nombre: 'Uruguay', zonaHoraria: 'America/Montevideo',
    modismos: '"bo" y "che" son formas de llamar a alguien, "gurí" o "gurisa" es niño o niña, "laburo" es trabajo, "guita" es dinero, "botija" es niño, "ta" es "está bien", "la Intendencia" es el gobierno departamental.',
  },
];

export function mercado(iso: string): Mercado | undefined {
  return MERCADOS.find((m) => m.iso === iso.toUpperCase());
}

export function nombreMercado(iso: string): string {
  return mercado(iso)?.nombre ?? iso.toUpperCase();
}
