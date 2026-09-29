/**
 * Nuevo bot: nombre, caso, mercado, trato y de quién es (candidato y partido, que arman la plantilla de la versión 1).
 * La clave del formulario evita crear dos bots con un doble envío.
 */
import { randomUUID } from 'node:crypto';
import { DESCRIPCION_CASO, ETIQUETA_CASO, ETIQUETA_TRATO, LARGO_CANDIDATO, LARGO_NOMBRE } from '../dominio/bots';
import { MERCADOS, mercado } from '../dominio/mercados';
import { ETIQUETA_FUNCION, MOTORES_POR_DEFECTO, fichaMotor } from '../dominio/motores';
import { puede } from '../dominio/permisos';
import { CASOS, TRATOS } from '../dominio/tipos';
import { ruta, type ContextoPantalla } from '../ui/contexto';
import { mensajeDe, type MensajePantalla } from './mensajes';

export interface VistaNuevoBot {
  mensaje: MensajePantalla | null;
  puedeCrear: boolean;
  campanaId: string;
  clave: string;
  volver: string;
  largoNombre: number;
  largoCandidato: number;
  /** El partido que se sugiere: el nombre de la organización. */
  partidoInicial: string;
  casos: { valor: string; texto: string; descripcion: string }[];
  mercados: { valor: string; texto: string }[];
  mercadoInicial: string;
  tratos: { valor: string; texto: string }[];
  motores: string[];
  hrefLista: string;
}

export function vistaNuevoBot(ctx: ContextoPantalla): VistaNuevoBot {
  return {
    mensaje: mensajeDe(ctx.parametros),
    puedeCrear: puede(ctx.rol, 'editar_borrador') && !ctx.organizacion.demo,
    campanaId: ctx.campana.id,
    clave: randomUUID(),
    volver: ruta(ctx, 'nuevo'),
    largoNombre: LARGO_NOMBRE,
    largoCandidato: LARGO_CANDIDATO,
    partidoInicial: ctx.organizacion.nombre,
    casos: CASOS.map((c) => ({ valor: c, texto: ETIQUETA_CASO[c], descripcion: DESCRIPCION_CASO[c] })),
    mercados: MERCADOS.map((m) => ({ valor: m.iso, texto: m.nombre })),
    mercadoInicial: mercado(ctx.campana.paisIso)?.iso ?? MERCADOS[0]!.iso,
    tratos: TRATOS.map((t) => ({ valor: t, texto: ETIQUETA_TRATO[t] })),
    motores: MOTORES_POR_DEFECTO.map((m) => `${ETIQUETA_FUNCION[m.funcion]}: ${fichaMotor(m.principal)?.nombre ?? m.principal}${m.respaldo ? `${m.dobleLectura ? ' y ' : ', respaldo '}${fichaMotor(m.respaldo)?.nombre ?? m.respaldo}${m.dobleLectura ? ' en doble lectura' : ''}` : ''}`),
    hrefLista: ruta(ctx),
  };
}
