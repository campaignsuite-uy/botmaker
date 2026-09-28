/**
 * Núcleo de las acciones sobre los bots, sin Next (se prueba sin navegador). Recibe el rol que resolvió el servidor,
 * vuelve a exigir la acción, valida con zod y llama al repositorio, que en Supabase lo exige otra vez en la base.
 * No es un archivo 'use server'.
 */
import type { Repositorio } from '../datos/repositorio';
import { ErrorDatos } from '../datos/errores';
import { codigoError, esquemaCambiosBot, esquemaDatosPersonales, esquemaNuevoBot, esquemaTopes } from '../dominio/bots';
import { puede, type Accion } from '../dominio/permisos';
import { FUNCIONES, type Bot, type EleccionMotores, type FuncionMotor, type RolEfectivo } from '../dominio/tipos';
import type { CapaMotores } from '../motores/capa';
import { ENTRADA_PRUEBA } from '../motores/prueba';
import { numeroDe, texto } from './comun';

export interface Salida {
  tipo: 'ok' | 'error';
  codigo: string;
  /** Parámetros extra de la vuelta (por ejemplo, el resultado de probar un motor). */
  extra?: Record<string, string>;
  /** A dónde ir si no es la pantalla de origen (por ejemplo, el bot recién creado). */
  botId?: string;
}

export interface ContextoNucleo {
  repo: Repositorio;
  rol: RolEfectivo | null;
  personaId: string;
  campanaId: string;
  /** Nombre y país de la campaña: el contexto de las instrucciones al probar un motor. */
  campana?: { nombre: string };
}

const mal = (codigo: string, extra?: Record<string, string>): Salida => ({ tipo: 'error', codigo, extra });
const ok = (codigo: string, extra?: Record<string, string>): Salida => ({ tipo: 'ok', codigo, extra });

function salidaDeError(e: unknown): Salida {
  if (e instanceof ErrorDatos) return mal(e.codigo);
  if (e && typeof e === 'object' && 'issues' in e) return mal('datos');
  return mal('no_se_pudo');
}

async function botDeCampana(c: ContextoNucleo, fd: FormData): Promise<Bot | null> {
  const b = await c.repo.bot(texto(fd, 'botId'));
  return b && b.campanaId === c.campanaId ? b : null;
}

function exige(c: ContextoNucleo, accion: Accion): Salida | null {
  return puede(c.rol, accion) ? null : mal('sin_permiso');
}

export async function ejecutarCrearBot(c: ContextoNucleo, fd: FormData): Promise<Salida> {
  const sin = exige(c, 'editar_borrador');
  if (sin) return sin;
  const v = esquemaNuevoBot.safeParse({ nombre: texto(fd, 'nombre'), caso: texto(fd, 'caso'), mercado: texto(fd, 'mercado'), trato: texto(fd, 'trato') });
  if (!v.success) return mal(codigoError(v.error));
  const clave = texto(fd, 'clave');
  if (!/^[0-9a-f-]{36}$/i.test(clave)) return mal('datos');
  try {
    const id = await c.repo.crearBot(c.campanaId, v.data, clave, c.personaId);
    return { tipo: 'ok', codigo: 'bot_creado', botId: id };
  } catch (e) {
    return salidaDeError(e);
  }
}

export async function ejecutarGuardarBot(c: ContextoNucleo, fd: FormData): Promise<Salida> {
  const sin = exige(c, 'editar_borrador');
  if (sin) return sin;
  const b = await botDeCampana(c, fd);
  if (!b) return mal('no_existe');
  const v = esquemaCambiosBot.safeParse({
    nombre: texto(fd, 'nombre'), caso: texto(fd, 'caso'), mercado: texto(fd, 'mercado'), trato: texto(fd, 'trato'), avisoIa: texto(fd, 'avisoIa'),
  });
  if (!v.success) return mal(codigoError(v.error));
  try {
    await c.repo.guardarBot(b.id, v.data, c.personaId);
    return ok('bot_guardado');
  } catch (e) {
    return salidaDeError(e);
  }
}

export async function ejecutarGuardarMotores(c: ContextoNucleo, fd: FormData): Promise<Salida> {
  const sin = exige(c, 'elegir_motores');
  if (sin) return sin;
  const b = await botDeCampana(c, fd);
  if (!b) return mal('no_existe');
  const fichas = await c.repo.fichas();
  const motores: EleccionMotores = {};
  for (const f of FUNCIONES) {
    const principal = texto(fd, `principal_${f}`);
    if (!principal) continue;
    const respaldo = texto(fd, `respaldo_${f}`) || null;
    const existe = (id: string) => fichas.some((x) => x.id === id && x.activo);
    const sirve = (id: string) => fichas.some((x) => x.id === id && x.funciones.includes(f));
    if (!existe(principal) || (respaldo && !existe(respaldo))) return mal('motor');
    if (!sirve(principal) || (respaldo && !sirve(respaldo))) return mal('motor_funcion');
    if (respaldo === principal) return mal('respaldo_igual');
    motores[f] = { principal, respaldo };
  }
  const t = esquemaTopes.safeParse({ diarioUsd: numeroDe(texto(fd, 'topeDiario')), mensualUsd: numeroDe(texto(fd, 'topeMensual')) });
  if (!t.success) return mal(codigoError(t.error));
  try {
    await c.repo.guardarMotores(b.id, motores, t.data, c.personaId);
    return ok('motores_guardados');
  } catch (e) {
    return salidaDeError(e);
  }
}

export async function ejecutarGuardarDatosPersonales(c: ContextoNucleo, fd: FormData): Promise<Salida> {
  const sin = exige(c, 'gestionar_datos_contactos');
  if (sin) return sin;
  const b = await botDeCampana(c, fd);
  if (!b) return mal('no_existe');
  const v = esquemaDatosPersonales.safeParse({ personalizacion: texto(fd, 'personalizacion') === 'si', diasGuardado: numeroDe(texto(fd, 'dias')) });
  if (!v.success) return mal(codigoError(v.error));
  try {
    await c.repo.guardarDatosPersonales(b.id, v.data.personalizacion, v.data.diasGuardado, c.personaId);
    return ok('datos_personales_guardados');
  } catch (e) {
    return salidaDeError(e);
  }
}

export async function ejecutarArchivarBot(c: ContextoNucleo, fd: FormData): Promise<Salida> {
  const sin = exige(c, 'publicar');
  if (sin) return sin;
  const b = await botDeCampana(c, fd);
  if (!b) return mal('no_existe');
  if (texto(fd, 'confirmar') !== 'si') return mal('datos');
  try {
    await c.repo.archivarBot(b.id, c.personaId);
    return ok('bot_archivado');
  } catch (e) {
    return salidaDeError(e);
  }
}

/**
 * Probar un motor: un pedido chico de prueba (motores/prueba.ts) al motor elegido, con la clave del copiloto. Queda
 * registrado como uso "pruebas" con su costo. Vuelve con el resultado en la dirección (sin textos del bot).
 */
export async function ejecutarProbarMotor(c: ContextoNucleo, capa: CapaMotores, fd: FormData): Promise<Salida> {
  const sin = exige(c, 'elegir_motores');
  if (sin) return sin;
  const b = await botDeCampana(c, fd);
  if (!b) return mal('no_existe');
  const funcion = texto(fd, 'funcion') as FuncionMotor;
  if (!FUNCIONES.includes(funcion)) return mal('datos');
  const motor = texto(fd, 'motor');
  const ficha = (await c.repo.fichas()).find((f) => f.id === motor && f.activo);
  if (!ficha) return mal('motor');
  if (!ficha.funciones.includes(funcion)) return mal('motor_funcion');
  const r = await capa.llamar({
    funcion,
    uso: 'pruebas',
    bot: { id: b.id, campanaId: c.campanaId },
    contexto: { nombreBot: b.nombre, campana: c.campana?.nombre ?? '', mercado: b.mercado, caso: b.caso, trato: b.trato },
    entrada: ENTRADA_PRUEBA[funcion],
    personaId: c.personaId,
    soloMotor: motor,
  });
  const intento = r.intentos[0];
  let detalle = intento?.error ?? r.motivo ?? '';
  if (r.salida) {
    const s = r.salida as unknown as Record<string, unknown>;
    detalle = funcion === 'interpretar' ? `Intención: ${s.intencion} · tema: ${s.tema} · confianza ${s.confianza}`
      : funcion === 'responder' ? `Respuesta: ${String(s.respuesta).slice(0, 120)}`
        : `Explicación: ${String(s.explicacion).slice(0, 120)}`;
  }
  return {
    tipo: r.salida ? 'ok' : 'error',
    codigo: r.salida ? 'prueba_ok' : 'prueba_falla',
    extra: {
      prueba: r.salida ? 'ok' : 'falla',
      motor: r.simulado ? 'simulado' : motor,
      funcion,
      ms: String(Math.round(r.demoraMs)),
      usd: String(r.costoUsd),
      detalle,
    },
  };
}
