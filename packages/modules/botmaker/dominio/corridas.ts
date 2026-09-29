/**
 * Corridas de prueba (etapa 4, tareas 4.04 y 4.05): cada versión se prueba con sus casos antes de publicarse, con los
 * motores del bot o con otra combinación para comparar. Acá están los tipos, cómo se evalúa cada caso y el resumen.
 *
 * - Un caso de intención acierta si la intención final (después de las reglas y la doble lectura) es la esperada o una
 *   de las otras válidas. Cuenta como aclaración si las dos lecturas no coinciden y llevan a lugares distintos.
 * - Un caso con base acierta si contesta cuando el material tiene el dato, reconoce que no lo tiene cuando no, y el
 *   validador de datos no corta nada. No hay juez en la app: el juez está en la prueba de motores (pnpm motores:responder).
 */

export type EstadoCorrida = 'en_curso' | 'terminada' | 'cancelada';

export interface ResultadoCaso {
  caso: string;
  tipo: 'intencion' | 'base';
  /** null: el motor no respondió (no cuenta como error del bot: se cuenta aparte). */
  ok: boolean | null;
  resultado: Record<string, unknown>;
  costo: number;
}

export interface ResumenCorrida {
  casos: number;
  /** El acierto de las intenciones (%): es el que se compara para pedir publicar. */
  acierto: number | null;
  intencion: { casos: number; porReglas: number; sinRespuesta: number; acierto: number | null; coinciden: number | null; aciertoCuandoCoinciden: number | null; aclaracion: number | null };
  base: { casos: number; sinRespuesta: number; acierto: number | null; contesta: number | null; reconoce: number | null; cortadas: number | null };
  costoUsd: number;
  demoraP50: number | null;
}

export interface Corrida {
  id: string;
  botId: string;
  versionId: string;
  versionSeq: number;
  /** La combinación de motores: { interpretar: {principal, respaldo, dobleLectura}, responder: {...} }. */
  motores: Record<string, unknown>;
  etiqueta: string;
  estado: EstadoCorrida;
  total: number;
  hechos: number;
  resumen: ResumenCorrida | null;
  costoUsd: number;
  creadaPor: string | null;
  creadaEn: string;
  terminadaEn: string | null;
}

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);

export function evaluarBase(esperado: 'si' | 'no' | 'parcial', tieneRespuesta: 'si' | 'no' | 'parcial', cortes: number): boolean {
  if (cortes > 0) return false;
  if (esperado === 'no') return tieneRespuesta !== 'si';
  return tieneRespuesta !== 'no';
}

export function resumirCorrida(rs: readonly ResultadoCaso[]): ResumenCorrida {
  const int = rs.filter((r) => r.tipo === 'intencion');
  const conMotor = int.filter((r) => r.resultado.lectura !== 'regla');
  const intResp = int.filter((r) => r.ok !== null);
  const coinciden = conMotor.filter((r) => r.resultado.lectura === 'coinciden');
  const base = rs.filter((r) => r.tipo === 'base');
  const baseResp = base.filter((r) => r.ok !== null);
  const conDato = baseResp.filter((r) => r.resultado.esperado !== 'no');
  const sinDato = baseResp.filter((r) => r.resultado.esperado === 'no');
  const demoras = rs.map((r) => Number(r.resultado.demoraMs)).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  const acierto = pct(intResp.filter((r) => r.ok).length, intResp.length);
  return {
    casos: rs.length,
    acierto,
    intencion: {
      casos: int.length,
      porReglas: int.length - conMotor.length,
      sinRespuesta: int.length - intResp.length,
      acierto,
      coinciden: pct(coinciden.length, conMotor.length),
      aciertoCuandoCoinciden: pct(coinciden.filter((r) => r.ok).length, coinciden.length),
      aclaracion: pct(int.filter((r) => r.resultado.aclaracion === true).length, int.length),
    },
    base: {
      casos: base.length,
      sinRespuesta: base.length - baseResp.length,
      acierto: pct(baseResp.filter((r) => r.ok).length, baseResp.length),
      contesta: pct(conDato.filter((r) => r.resultado.tieneRespuesta !== 'no').length, conDato.length),
      reconoce: pct(sinDato.filter((r) => r.resultado.tieneRespuesta !== 'si').length, sinDato.length),
      cortadas: pct(baseResp.filter((r) => Array.isArray(r.resultado.cortes) && (r.resultado.cortes as unknown[]).length > 0).length, baseResp.length),
    },
    costoUsd: Math.round(rs.reduce((a, r) => a + r.costo, 0) * 1e6) / 1e6,
    demoraP50: demoras.length ? demoras[Math.floor(demoras.length / 2)]! : null,
  };
}

/** Lo que cambió entre dos corridas, caso por caso (para comparar motores o versiones). */
export function compararCorridas(a: readonly ResultadoCaso[], b: readonly ResultadoCaso[]) {
  const deB = new Map(b.map((r) => [r.caso, r]));
  const distintos: { caso: string; tipo: string; a: ResultadoCaso; b: ResultadoCaso }[] = [];
  for (const x of a) {
    const y = deB.get(x.caso);
    if (y && x.ok !== y.ok) distintos.push({ caso: x.caso, tipo: x.tipo, a: x, b: y });
  }
  return {
    mejoran: distintos.filter((d) => d.b.ok === true && d.a.ok !== true),
    empeoran: distintos.filter((d) => d.a.ok === true && d.b.ok !== true),
    enComun: a.filter((x) => deB.has(x.caso)).length,
  };
}

/** La etiqueta de una combinación de motores: "Interpretar: Gemini + gpt-oss (doble lectura) · Responder: Gemini > Haiku". */
export function etiquetaMotores(m: Record<string, { principal: string; respaldo: string | null; dobleLectura?: boolean } | undefined>, nombre: (id: string) => string = (x) => x): string {
  const parte = (f: string, t: string) => {
    const x = m[f];
    if (!x) return null;
    return `${t}: ${nombre(x.principal)}${x.respaldo ? `${x.dobleLectura ? ' + ' : ' > '}${nombre(x.respaldo)}` : ''}${x.dobleLectura && x.respaldo ? ' (doble lectura)' : ''}`;
  };
  return [parte('interpretar', 'Interpretar'), parte('responder', 'Responder')].filter(Boolean).join(' · ');
}
