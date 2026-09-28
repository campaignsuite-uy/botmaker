/**
 * Costos: lo que gastaron los motores en la campaña, por día, por bot, por uso, por función y por motor, y las últimas
 * llamadas. Solo quien tiene 'ver_costos' (el administrador y, en una demo, el observador). Horas en UTC.
 */
import type { Repositorio } from '../datos/repositorio';
import { ETIQUETA_FUNCION, fichaMotor } from '../dominio/motores';
import { diaUtc, entero, fechaHoraUtc, fechaUtc, milisegundos, sumarDias, usd } from '../dominio/formato';
import type { UsoMotor } from '../dominio/tipos';
import type { ContextoPantalla } from '../ui/contexto';

export const ETIQUETA_USO: Record<UsoMotor, string> = {
  en_vivo: 'En vivo',
  copiloto: 'Copiloto',
  simulador: 'Simulador',
  pruebas: 'Pruebas',
  fondo: 'Tareas de fondo',
};

export interface VistaCostos {
  dias: number;
  total: string;
  llamadas: string;
  fallidas: string;
  porDia: { dia: string; costo: string; valor: number; llamadas: number }[];
  maximoDia: number;
  porBot: { nombre: string; costo: string; llamadas: string }[];
  porUso: { uso: string; costo: string; llamadas: string }[];
  porFuncion: { funcion: string; costo: string; llamadas: string }[];
  porMotor: { motor: string; costo: string; llamadas: string; demora: string; respaldo: string }[];
  ultimas: { fecha: string; bot: string; uso: string; funcion: string; motor: string; ok: boolean; error: string; demora: string; costo: string; respaldo: boolean }[];
}

export async function vistaCostos(repo: Repositorio, ctx: ContextoPantalla, ahora = new Date()): Promise<VistaCostos> {
  const DIAS = 30;
  const desde = sumarDias(diaUtc(ahora), -(DIAS - 1));
  const [bots, llamadas, fichas] = await Promise.all([
    repo.bots(ctx.campana.id, { archivados: true }),
    repo.llamadas(ctx.campana.id, { desde: `${desde}T00:00:00.000Z`, limite: 5000 }),
    repo.fichas(),
  ]);
  const nombreBot = (id: string) => bots.find((b) => b.id === id)?.nombre ?? 'Bot borrado';
  const nombreMotor = (id: string) => fichaMotor(id, fichas)?.nombre ?? id;
  const sumar = <K extends string>(clave: (l: (typeof llamadas)[number]) => K) => {
    const m = new Map<K, { costo: number; n: number; demora: number; conDemora: number; respaldo: number }>();
    for (const l of llamadas) {
      const k = clave(l);
      const x = m.get(k) ?? { costo: 0, n: 0, demora: 0, conDemora: 0, respaldo: 0 };
      x.costo += l.costoUsd;
      x.n += 1;
      if (l.ok && l.demoraMs != null) { x.demora += l.demoraMs; x.conDemora += 1; }
      if (l.respaldo) x.respaldo += 1;
      m.set(k, x);
    }
    return [...m.entries()].sort((a, b) => b[1].costo - a[1].costo);
  };
  const porDiaMapa = new Map<string, { costo: number; n: number }>();
  for (let i = 0; i < DIAS; i++) porDiaMapa.set(sumarDias(desde, i), { costo: 0, n: 0 });
  for (const l of llamadas) {
    const d = porDiaMapa.get(l.fecha.slice(0, 10));
    if (d) { d.costo += l.costoUsd; d.n += 1; }
  }
  const porDia = [...porDiaMapa.entries()].map(([dia, x]) => ({ dia: fechaUtc(dia), costo: usd(x.costo), valor: x.costo, llamadas: x.n }));
  const total = llamadas.reduce((a, l) => a + l.costoUsd, 0);
  return {
    dias: DIAS,
    total: usd(total),
    llamadas: entero(llamadas.length),
    fallidas: entero(llamadas.filter((l) => !l.ok).length),
    porDia,
    maximoDia: Math.max(0, ...porDia.map((d) => d.valor)),
    porBot: sumar((l) => l.botId).map(([k, x]) => ({ nombre: nombreBot(k), costo: usd(x.costo), llamadas: entero(x.n) })),
    porUso: sumar((l) => l.uso).map(([k, x]) => ({ uso: ETIQUETA_USO[k], costo: usd(x.costo), llamadas: entero(x.n) })),
    porFuncion: sumar((l) => l.funcion).map(([k, x]) => ({ funcion: ETIQUETA_FUNCION[k], costo: usd(x.costo), llamadas: entero(x.n) })),
    porMotor: sumar((l) => l.motorId).map(([k, x]) => ({
      motor: nombreMotor(k), costo: usd(x.costo), llamadas: entero(x.n),
      demora: x.conDemora ? milisegundos(x.demora / x.conDemora) : '—', respaldo: entero(x.respaldo),
    })),
    ultimas: llamadas.slice(0, 25).map((l) => ({
      fecha: fechaHoraUtc(l.fecha), bot: nombreBot(l.botId), uso: ETIQUETA_USO[l.uso], funcion: ETIQUETA_FUNCION[l.funcion],
      motor: nombreMotor(l.motorId), ok: l.ok, error: l.error ?? '', demora: milisegundos(l.demoraMs), costo: usd(l.costoUsd), respaldo: l.respaldo,
    })),
  };
}
