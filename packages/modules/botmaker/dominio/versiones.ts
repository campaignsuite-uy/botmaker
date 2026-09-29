/**
 * Versiones del bot y cambios del borrador (bots.versions y bots.version_changes, bots_0003_versiones.sql).
 *
 * El borrador es la única versión que se cambia, y solo con cambios: una o varias operaciones (dominio/operaciones.ts)
 * que se guardan juntas con su inversa. Deshacer y rehacer también son cambios, que apuntan al que deshacen o rehacen;
 * las pilas salen de recorrer el historial en orden (pilasDeshacer), así el historial queda completo y nadie lo edita.
 */
import type { Operacion } from './operaciones';

export const ESTADOS_VERSION = ['borrador', 'pedida', 'aprobada', 'publicada', 'devuelta', 'archivada'] as const;
export type EstadoVersion = (typeof ESTADOS_VERSION)[number];

export const ETIQUETA_ESTADO_VERSION: Record<EstadoVersion, string> = {
  borrador: 'Borrador',
  pedida: 'Publicación pedida',
  aprobada: 'Aprobada',
  publicada: 'Publicada',
  devuelta: 'Devuelta con comentarios',
  archivada: 'Archivada',
};

export interface Version {
  id: string;
  botId: string;
  campanaId: string;
  numero: number;
  estado: EstadoVersion;
  basadaEn: string | null;
  /** Cantidad de cambios guardados: quien cambia manda el que vio, y la base corta si otra persona cambió en el medio. */
  seq: number;
  creadaPor: string | null;
  creadaEn: string;
  actualizadaEn: string;
}

/** El borrador con su definición tal como está guardada (el servidor la valida con validarDefinicion al leerla). */
export interface Borrador extends Version {
  definicion: unknown;
}

export const ORIGENES_CAMBIO = ['editor', 'yaml', 'copiloto', 'deshacer', 'rehacer'] as const;
export type OrigenCambio = (typeof ORIGENES_CAMBIO)[number];

export const ETIQUETA_ORIGEN: Record<OrigenCambio, string> = {
  editor: 'Editor',
  yaml: 'YAML',
  copiloto: 'Copiloto',
  deshacer: 'Deshacer',
  rehacer: 'Rehacer',
};

export interface NuevoCambio {
  origen: OrigenCambio;
  operaciones: Operacion[];
  inversa: Operacion;
  resumen: string;
  /** Solo deshacer y rehacer: el seq del cambio que deshacen o rehacen. */
  objetivo: number | null;
}

/** Un cambio del historial sin sus operaciones ni su inversa: lo que se lista y lo que alcanza para las pilas. */
export interface CambioResumen {
  seq: number;
  origen: OrigenCambio;
  resumen: string;
  objetivo: number | null;
  personaId: string | null;
  fecha: string;
}

export type Cambio = CambioResumen & NuevoCambio;

/**
 * Lo que haría el botón: qué cambio deshace (o rehace) y de qué cambio del historial sale la operación que hay que
 * aplicar (su inversa). Así las pilas se calculan sin leer las inversas, que pueden ser grandes.
 */
export interface PasoHistorial {
  objetivo: number;
  /** El seq del cambio cuya inversa se aplica. */
  desde: number;
  resumen: string;
}

export interface Pilas {
  deshacer: PasoHistorial | null;
  rehacer: PasoHistorial | null;
}

/**
 * Las pilas de deshacer y rehacer, recorriendo el historial del más viejo al más nuevo:
 *  - un cambio normal entra a "hechos" y vacía "deshechos" (después de un cambio nuevo ya no se rehace lo anterior);
 *  - deshacer saca el último hecho y lo pone en deshechos, con la inversa del deshacer (que lo rehace);
 *  - rehacer lo vuelve a hechos, con la inversa del rehacer (que lo deshace otra vez).
 * Un historial que no cierra (un deshacer que no apunta al último hecho) deja las dos pilas vacías: mejor no ofrecer
 * deshacer que deshacer otra cosa.
 */
export function pilasDeshacer(cambios: readonly CambioResumen[]): Pilas {
  const hechos: PasoHistorial[] = [];
  let deshechos: PasoHistorial[] = [];
  for (const c of [...cambios].sort((a, b) => a.seq - b.seq)) {
    if (c.origen === 'deshacer') {
      const tope = hechos.pop();
      if (!tope || tope.objetivo !== c.objetivo) return { deshacer: null, rehacer: null };
      deshechos.push({ objetivo: tope.objetivo, desde: c.seq, resumen: tope.resumen });
    } else if (c.origen === 'rehacer') {
      const tope = deshechos.pop();
      if (!tope || tope.objetivo !== c.objetivo) return { deshacer: null, rehacer: null };
      hechos.push({ objetivo: tope.objetivo, desde: c.seq, resumen: tope.resumen });
    } else {
      hechos.push({ objetivo: c.seq, desde: c.seq, resumen: c.resumen });
      deshechos = [];
    }
  }
  return { deshacer: hechos.at(-1) ?? null, rehacer: deshechos.at(-1) ?? null };
}
