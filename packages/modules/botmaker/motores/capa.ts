/**
 * Capa de motores: el único lugar del producto que llama a un modelo. El resto pide interpretar, responder con base o
 * copiloto y recibe una salida validada, sin saber qué modelo contestó.
 *
 * Por cada pedido:
 *  1. Toma el motor principal y el de respaldo de esa función en el bot (bots.bot_engines).
 *  2. En vivo, mira el gasto del día y del mes contra los topes del bot: si no queda, no llama a nadie (solo menús).
 *  3. Cambia teléfonos, correos y documentos por marcas en lo que escribió la persona.
 *  4. Llama al principal con su tiempo máximo; si falla, tarda o devuelve algo que no valida, llama al respaldo.
 *     Interpretar en doble lectura llama a los dos a la vez y compara (ver `lectura` en el resultado).
 *  5. Registra cada intento (sin textos) en bots.engine_calls, que suma el gasto del día.
 *  6. Si nada sirvió, devuelve salida null: el motor de conversación sigue solo con menús.
 */
import { fichaMotor, type FichaMotor } from '../dominio/motores';
import { diaUtc, inicioMesUtc } from '../dominio/formato';
import type { FuncionMotor, MotorFuncion, NuevaLlamada, UsoMotor } from '../dominio/tipos';
import type { Repositorio } from '../datos/repositorio';
import { contratoCopiloto, contratoInterpretar, contratoResponder, extraerJson, MAX_ALTERNATIVAS, MAX_TOKENS, type EntradaDe, type SalidaDe } from './contratos';
import { marcarDatosPersonales } from './marcas';
import { instruccionesCopiloto, instruccionesInterpretar, instruccionesResponder, type ContextoBot, type Instrucciones } from './prompts';
import type { Adaptador, LlamadaCruda } from './tipos';

export interface PedidoCapa<F extends FuncionMotor> {
  funcion: F;
  uso: UsoMotor;
  bot: { id: string; campanaId: string };
  contexto: ContextoBot;
  entrada: EntradaDe[F];
  /** Quién lo disparó (el equipo: copiloto, simulador, pruebas). null en vivo. */
  personaId: string | null;
  /** Solo para probar un motor puntual (Ajustes › Motores): se salta la elección del bot y el respaldo. */
  soloMotor?: string;
}

export interface IntentoMotor {
  motorId: string;
  respaldo: boolean;
  ok: boolean;
  error: string | null;
  demoraMs: number;
  costoUsd: number;
}

/**
 * Interpretar en doble lectura: qué eligió cada motor y cómo se combinó.
 *  - coinciden: los dos eligieron la misma intención; la salida es la del principal.
 *  - distintas: eligieron intenciones distintas; la salida es la del principal con la del respaldo como primera
 *    alternativa, y el motor de conversación pregunta con dos botones (salvo que las dos lleven al mismo lugar).
 *  - una: respondió uno solo; la salida es la suya, sin segunda lectura.
 *  - ninguna: no respondió ninguno; sin salida (solo menús).
 */
export interface LecturaDoble {
  principal: string | null;
  respaldo: string | null;
  resultado: 'coinciden' | 'distintas' | 'una' | 'ninguna';
}

export interface ResultadoCapa<F extends FuncionMotor> {
  salida: SalidaDe[F] | null;
  /** El motor que dio la salida. */
  motorId: string | null;
  respaldo: boolean;
  /** Por qué no hubo salida. */
  motivo: 'tope_diario' | 'tope_mensual' | 'sin_motor' | 'fallaron' | null;
  intentos: IntentoMotor[];
  costoUsd: number;
  /** La demora que vio la persona: la suma de los intentos en serie, o la del más lento en doble lectura. */
  demoraMs: number;
  simulado: boolean;
  /** Solo interpretar en doble lectura; null en los demás casos. */
  lectura: LecturaDoble | null;
}

export type RepositorioCapa = Pick<Repositorio, 'topesBot' | 'fichas' | 'motoresDeBot' | 'gastoBot' | 'registrarLlamada'>;

export interface OpcionesCapa {
  repo: RepositorioCapa;
  adaptadores: { openrouter: Adaptador; simulado: Adaptador };
  /** Todo al motor simulado (la demo y las pruebas). Ver motores/claves.ts → simularMotores. */
  simular: boolean;
  ahora?: () => Date;
}

function instrucciones<F extends FuncionMotor>(p: PedidoCapa<F>, entrada: EntradaDe[F]): Instrucciones {
  if (p.funcion === 'interpretar') return instruccionesInterpretar(p.contexto, entrada as EntradaDe['interpretar']);
  if (p.funcion === 'responder') return instruccionesResponder(p.contexto, entrada as EntradaDe['responder']);
  return instruccionesCopiloto(p.contexto, entrada as EntradaDe['copiloto']);
}

function contrato<F extends FuncionMotor>(p: PedidoCapa<F>) {
  if (p.funcion === 'interpretar') return contratoInterpretar(p.entrada as EntradaDe['interpretar']);
  if (p.funcion === 'responder') return contratoResponder;
  return contratoCopiloto;
}

/** Lo que escribió la persona, con marcas en lugar de sus datos. El copiloto es del equipo: va tal cual. */
function marcar<F extends FuncionMotor>(p: PedidoCapa<F>): EntradaDe[F] {
  if (p.funcion === 'copiloto') return p.entrada;
  const m = (t: string) => marcarDatosPersonales(t).texto;
  const turnos = (p.entrada as EntradaDe['interpretar']).turnos.map((t) => (t.quien === 'persona' ? { ...t, texto: m(t.texto) } : t));
  if (p.funcion === 'interpretar') {
    const e = p.entrada as EntradaDe['interpretar'];
    return { ...e, mensaje: m(e.mensaje), turnos } as EntradaDe[F];
  }
  const e = p.entrada as EntradaDe['responder'];
  return { ...e, pregunta: m(e.pregunta), turnos } as EntradaDe[F];
}

interface Intento<F extends FuncionMotor> {
  salida: SalidaDe[F] | null;
  intento: IntentoMotor;
  simulado: boolean;
}

interface Preparado<F extends FuncionMotor> {
  sistema: string;
  usuario: string;
  esquema: { nombre: string; schema: Record<string, unknown> };
  zod: { safeParse: (x: unknown) => { success: boolean; data?: unknown } };
  entrada: EntradaDe[F];
  tiempoMaximoMs: number;
}

const suma = (xs: IntentoMotor[], k: 'costoUsd' | 'demoraMs') => xs.reduce((a, i) => a + i[k], 0);

export class CapaMotores {
  private readonly ahora: () => Date;

  constructor(private readonly o: OpcionesCapa) {
    this.ahora = o.ahora ?? (() => new Date());
  }

  get simula(): boolean {
    return this.o.simular;
  }

  async llamar<F extends FuncionMotor>(p: PedidoCapa<F>): Promise<ResultadoCapa<F>> {
    const vacio = (motivo: ResultadoCapa<F>['motivo'], intentos: IntentoMotor[] = [], lectura: LecturaDoble | null = null): ResultadoCapa<F> => ({
      salida: null, motorId: null, respaldo: false, motivo, intentos,
      costoUsd: suma(intentos, 'costoUsd'), demoraMs: lectura ? Math.max(0, ...intentos.map((i) => i.demoraMs)) : suma(intentos, 'demoraMs'),
      simulado: this.o.simular, lectura,
    });

    const fichas = await this.o.repo.fichas();
    let elegidos: { ficha: FichaMotor; respaldo: boolean }[];
    let tiempoMaximoMs: number;
    let doble = false;
    if (p.soloMotor) {
      const f = fichaMotor(p.soloMotor, fichas);
      if (!f) return vacio('sin_motor');
      const delBot = (await this.o.repo.motoresDeBot(p.bot.id)).find((m) => m.funcion === p.funcion);
      elegidos = [{ ficha: f, respaldo: false }];
      tiempoMaximoMs = delBot?.tiempoMaximoMs ?? 10000;
    } else {
      const m: MotorFuncion | undefined = (await this.o.repo.motoresDeBot(p.bot.id)).find((x) => x.funcion === p.funcion);
      if (!m) return vacio('sin_motor');
      elegidos = [
        { id: m.principal, respaldo: false },
        ...(m.respaldo ? [{ id: m.respaldo, respaldo: true }] : []),
      ].flatMap((x) => {
        const f = fichaMotor(x.id, fichas);
        return f && f.activo ? [{ ficha: f, respaldo: x.respaldo }] : [];
      });
      tiempoMaximoMs = m.tiempoMaximoMs;
      // La doble lectura necesita los dos motores activos; si uno está apagado, sigue con el que queda.
      doble = p.funcion === 'interpretar' && m.dobleLectura && elegidos.length === 2;
      if (!elegidos.length) return vacio('sin_motor');
    }

    // Topes del bot: solo en vivo (lo demás lo acota el tope de su clave en OpenRouter). Si no se pueden leer, no se
    // llama a nadie: un tope que no se controla es un tope que no existe.
    if (p.uso === 'en_vivo') {
      const topes = await this.o.repo.topesBot(p.bot.id).catch(() => null);
      if (!topes || !Number.isFinite(topes.diarioUsd) || !Number.isFinite(topes.mensualUsd)) return vacio('sin_motor');
      const hoy = diaUtc(this.ahora());
      const [dia, mes] = await Promise.all([
        this.o.repo.gastoBot(p.bot.id, hoy, 'en_vivo'),
        this.o.repo.gastoBot(p.bot.id, inicioMesUtc(this.ahora()), 'en_vivo'),
      ]);
      if (dia >= topes.diarioUsd) return vacio('tope_diario');
      if (mes >= topes.mensualUsd) return vacio('tope_mensual');
    }

    const entrada = marcar(p);
    const { sistema, usuario } = instrucciones(p, entrada);
    const { esquema, zod } = contrato(p);
    const prep: Preparado<F> = { sistema, usuario, esquema, zod: zod as Preparado<F>['zod'], entrada, tiempoMaximoMs };

    if (doble) return this.dobleLectura(p as unknown as PedidoCapa<'interpretar'>, elegidos, prep as unknown as Preparado<'interpretar'>) as unknown as ResultadoCapa<F>;

    const intentos: IntentoMotor[] = [];
    for (const { ficha, respaldo } of elegidos) {
      const r = await this.intentar(p, ficha, respaldo, prep);
      intentos.push(r.intento);
      if (r.salida) {
        return {
          salida: r.salida, motorId: r.intento.motorId, respaldo, motivo: null, intentos,
          costoUsd: suma(intentos, 'costoUsd'), demoraMs: suma(intentos, 'demoraMs'), simulado: this.o.simular || r.simulado, lectura: null,
        };
      }
    }
    return vacio('fallaron', intentos);
  }

  /** Los dos motores leen el mismo mensaje a la vez; se registran las dos llamadas. */
  private async dobleLectura(
    p: PedidoCapa<'interpretar'>,
    elegidos: { ficha: FichaMotor; respaldo: boolean }[],
    prep: Preparado<'interpretar'>,
  ): Promise<ResultadoCapa<'interpretar'>> {
    const [a, b] = await Promise.all(elegidos.map((e) => this.intentar(p, e.ficha, e.respaldo, prep))) as [Intento<'interpretar'>, Intento<'interpretar'>];
    const intentos = [a.intento, b.intento];
    const lectura: LecturaDoble = {
      principal: a.salida?.intencion ?? null,
      respaldo: b.salida?.intencion ?? null,
      resultado: a.salida && b.salida ? (a.salida.intencion === b.salida.intencion ? 'coinciden' : 'distintas') : a.salida || b.salida ? 'una' : 'ninguna',
    };
    const base = { intentos, costoUsd: suma(intentos, 'costoUsd'), demoraMs: Math.max(a.intento.demoraMs, b.intento.demoraMs), lectura };
    if (lectura.resultado === 'ninguna') {
      return { salida: null, motorId: null, respaldo: false, motivo: 'fallaron', simulado: this.o.simular, ...base };
    }
    const quien = a.salida ? a : b;
    let salida = quien.salida!;
    if (lectura.resultado === 'distintas') {
      // La lectura del respaldo pasa a ser la primera alternativa: son las dos opciones que el bot ofrece.
      const otra = { intencion: b.salida!.intencion, tema: b.salida!.tema, confianza: b.salida!.confianza };
      salida = { ...salida, alternativas: [otra, ...salida.alternativas.filter((x) => x.intencion !== otra.intencion && x.intencion !== salida.intencion)].slice(0, MAX_ALTERNATIVAS) };
    }
    return {
      salida, motorId: quien.intento.motorId, respaldo: quien === b, motivo: null,
      simulado: this.o.simular || quien.simulado, ...base,
    };
  }

  /** Un intento con un motor: llama, valida la salida con el contrato y lo registra. */
  private async intentar<F extends FuncionMotor>(p: PedidoCapa<F>, ficha: FichaMotor, respaldo: boolean, prep: Preparado<F>): Promise<Intento<F>> {
    const adaptador = this.o.simular || ficha.ruta === 'simulado' ? this.o.adaptadores.simulado : this.o.adaptadores.openrouter;
    const simulado = adaptador.ruta === 'simulado';
    let cruda: LlamadaCruda;
    try {
      cruda = await adaptador.llamar({
        ficha, funcion: p.funcion, uso: p.uso, sistema: prep.sistema, usuario: prep.usuario, esquema: prep.esquema,
        maxTokens: MAX_TOKENS[p.funcion], tiempoMaximoMs: prep.tiempoMaximoMs, entrada: prep.entrada,
      });
    } catch (e) {
      cruda = { ok: false, contenido: null, error: `Error del adaptador: ${String((e as Error)?.message ?? e).slice(0, 150)}`, demoraMs: 0, costoUsd: null, tokensEntrada: null, tokensSalida: null, tokensCache: null, tokensRazonamiento: null, proveedor: null, idGeneracion: null };
    }
    let salida: SalidaDe[F] | null = null;
    let error = cruda.error;
    if (cruda.ok && cruda.contenido) {
      const v = (() => {
        try {
          return prep.zod.safeParse(extraerJson(cruda.contenido!));
        } catch {
          return null;
        }
      })();
      if (v?.success) salida = v.data as SalidaDe[F];
      else error = 'La salida no cumple el contrato (JSON inválido o fuera del catálogo).';
    }
    const intento: IntentoMotor = {
      motorId: simulado ? 'simulado' : ficha.id,
      respaldo,
      ok: !!salida,
      error: salida ? null : (error ?? 'Sin salida.'),
      demoraMs: cruda.demoraMs,
      costoUsd: cruda.costoUsd ?? 0,
    };
    await this.registrar(p, ficha, cruda, intento, simulado);
    return { salida, intento, simulado };
  }

  private async registrar<F extends FuncionMotor>(p: PedidoCapa<F>, ficha: FichaMotor, c: LlamadaCruda, i: IntentoMotor, simulado: boolean): Promise<void> {
    const l: NuevaLlamada = {
      botId: p.bot.id,
      campanaId: p.bot.campanaId,
      uso: p.uso,
      funcion: p.funcion,
      motorId: i.motorId,
      modelo: simulado ? 'simulado' : ficha.modelo,
      proveedor: c.proveedor ?? '',
      respaldo: i.respaldo,
      ok: i.ok,
      error: i.error ? i.error.slice(0, 300) : null,
      demoraMs: c.demoraMs,
      tokensEntrada: c.tokensEntrada,
      tokensSalida: c.tokensSalida,
      tokensCache: c.tokensCache,
      tokensRazonamiento: c.tokensRazonamiento,
      costoUsd: c.costoUsd ?? 0,
      idGeneracion: c.idGeneracion,
      personaId: p.personaId,
    };
    try {
      await this.o.repo.registrarLlamada(l);
    } catch (e) {
      // El registro no puede tirar abajo la respuesta del bot: queda en el registro del servidor (Sentry, etapa 8).
      console.warn(`[motores] No se pudo registrar la llamada: ${(e as Error).message}`);
    }
  }
}
