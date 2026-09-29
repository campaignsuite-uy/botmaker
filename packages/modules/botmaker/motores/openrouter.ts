/**
 * Adaptador de OpenRouter. Sale del script de prueba de motores (botmaker-prueba-motores/src/motores/openrouter.ts),
 * que ya corrió contra los siete candidatos:
 *  - pide salida con esquema JSON estricto; si el modelo o el proveedor no lo aceptan, prueba con JSON simple y después
 *    con texto (y recuerda qué modo sirvió para cada modelo);
 *  - si el proveedor no acepta `temperature` (Claude Sonnet 5, Gemini con razonamiento), la saca y lo recuerda;
 *  - reintenta los errores transitorios (408, 429, 5xx, red) y el 402 de "presupuesto en vuelo" de OpenRouter, pero
 *    siempre dentro del tiempo máximo del pedido: en vivo casi no hay reintentos, y la capa pasa al respaldo;
 *  - el costo sale de `usage.cost`, que OpenRouter informa en cada respuesta.
 *
 * Nunca registra textos: ni las instrucciones ni la respuesta salen de acá salvo como resultado.
 */
import { claveOpenRouter, VARIABLE_CLAVE } from './claves';
import { llamadaFallida, type Adaptador, type LlamadaCruda, type PedidoAdaptador } from './tipos';

export const URL_OPENROUTER = 'https://openrouter.ai/api/v1';
const REINTENTABLES = new Set([408, 429, 500, 502, 503, 504, 520, 522, 524]);
const ESPERAS_MS = [700, 2000, 5000];
type ModoJson = 'json_schema' | 'json_object' | 'texto';
const MODOS: ModoJson[] = ['json_schema', 'json_object', 'texto'];

export interface OpcionesOpenRouter {
  /** fetch a usar (las pruebas pasan uno simulado). */
  fetch?: typeof fetch;
  /** Variables de entorno de donde salen las claves (por defecto, process.env). */
  entorno?: Record<string, string | undefined>;
  url?: string;
  /** Título que ve OpenRouter en sus registros de uso. */
  titulo?: string;
  dormir?: (ms: number) => Promise<void>;
}

interface RespuestaHttp {
  status: number;
  cuerpo: any;
  esperarS: number | null;
}

export class AdaptadorOpenRouter implements Adaptador {
  readonly ruta = 'openrouter' as const;
  private modoConocido = new Map<string, ModoJson>();
  private sinTemperatura = new Set<string>();
  private readonly f: typeof fetch;
  private readonly dormir: (ms: number) => Promise<void>;

  constructor(private readonly o: OpcionesOpenRouter = {}) {
    this.f = o.fetch ?? fetch;
    this.dormir = o.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async llamar(p: PedidoAdaptador): Promise<LlamadaCruda> {
    const clave = claveOpenRouter(p.uso, this.o.entorno);
    if (!clave) return llamadaFallida(`Falta la clave ${VARIABLE_CLAVE[p.uso]} en las variables de entorno del servidor.`);
    const inicio = Date.now();
    const limite = inicio + p.tiempoMaximoMs;
    const llave = `${p.ficha.modelo}:${p.funcion}`;
    let indiceModo = Math.max(0, MODOS.indexOf(this.modoConocido.get(llave) ?? 'json_schema'));
    let reintentos = 0;
    let ultimoError = 'sin intentos';

    while (indiceModo < MODOS.length) {
      const restante = limite - Date.now();
      if (restante <= 50) return llamadaFallida(`Sin respuesta en ${p.tiempoMaximoMs / 1000} s (${ultimoError})`, Date.now() - inicio);
      const modo = MODOS[indiceModo]!;
      const cuerpo = this.cuerpo(p, modo);
      let r: RespuestaHttp;
      try {
        r = await this.post(clave, cuerpo, restante);
      } catch (e: any) {
        ultimoError = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? `sin respuesta en ${p.tiempoMaximoMs / 1000} s` : `error de red: ${String(e?.message ?? e).slice(0, 120)}`;
        if (await this.esperarSiDa(reintentos++, limite)) continue;
        return llamadaFallida(ultimoError.charAt(0).toUpperCase() + ultimoError.slice(1), Date.now() - inicio);
      }

      if (r.status === 401) return llamadaFallida(`Clave de OpenRouter inválida o deshabilitada (401): revisá ${VARIABLE_CLAVE[p.uso]}.`, Date.now() - inicio);
      if (r.status === 402) {
        if (r.cuerpo?.error?.metadata?.limit_source === 'openrouter_in_flight_budget' && await this.esperarSiDa(reintentos++, limite)) continue;
        return llamadaFallida(`Sin saldo o tope de la clave alcanzado en OpenRouter (402): ${String(r.cuerpo?.error?.message ?? '').slice(0, 120)}`, Date.now() - inicio);
      }
      if (r.status === 403) return llamadaFallida(`Bloqueado por la moderación del proveedor (403).`, Date.now() - inicio);

      if (r.status >= 400 || r.cuerpo?.error) {
        if (this.noSoportaFormato(r)) {
          // Primero se prueba sin temperatura; si igual falla, se baja el modo de salida.
          if (cuerpo.temperature !== undefined) {
            this.sinTemperatura.add(p.ficha.modelo);
            continue;
          }
          if (indiceModo < MODOS.length - 1) {
            indiceModo++;
            continue;
          }
        }
        ultimoError = this.mensajeError(r);
        if (REINTENTABLES.has(r.status) && await this.esperarSiDa(reintentos++, limite, r.esperarS)) continue;
        return llamadaFallida(ultimoError, Date.now() - inicio);
      }

      const eleccion = r.cuerpo?.choices?.[0];
      const u = r.cuerpo?.usage ?? {};
      const contenido = textoDe(eleccion?.message?.content);
      const finish = eleccion?.finish_reason ?? eleccion?.native_finish_reason ?? null;
      this.modoConocido.set(llave, modo);
      const base: LlamadaCruda = {
        ok: true,
        contenido,
        error: null,
        demoraMs: Date.now() - inicio,
        costoUsd: typeof u.cost === 'number' ? u.cost : null,
        tokensEntrada: u.prompt_tokens ?? null,
        tokensSalida: u.completion_tokens ?? null,
        tokensCache: u.prompt_tokens_details?.cached_tokens ?? null,
        tokensRazonamiento: u.completion_tokens_details?.reasoning_tokens ?? null,
        proveedor: r.cuerpo?.provider ?? null,
        idGeneracion: r.cuerpo?.id ?? null,
      };
      if (eleccion?.error || finish === 'error') return { ...base, ok: false, contenido: null, error: 'El proveedor cortó la respuesta.' };
      if (!contenido || !contenido.trim()) {
        return { ...base, ok: false, error: finish === 'length' ? 'Respuesta vacía: se agotaron los tokens (probablemente razonando).' : 'Respuesta vacía.' };
      }
      return base;
    }
    return llamadaFallida(ultimoError, Date.now() - inicio);
  }

  private cuerpo(p: PedidoAdaptador, modo: ModoJson): Record<string, any> {
    const f = p.ficha;
    const sistema = f.cache ? [{ type: 'text', text: p.sistema, cache_control: { type: 'ephemeral' } }] : p.sistema;
    const cuerpo: Record<string, any> = {
      model: f.modelo,
      messages: [
        { role: 'system', content: sistema },
        { role: 'user', content: p.usuario },
      ],
      max_tokens: p.maxTokens,
      // Las preferencias de proveedor salen de la ficha (only, order…). Exigir retención cero (zdr) se decide por motor:
      // no todos los proveedores la ofrecen y, si no hay ninguno que cumpla, OpenRouter no responde.
      provider: { ...f.proveedor, require_parameters: modo !== 'texto' },
    };
    if (!f.sinTemperatura && !this.sinTemperatura.has(f.modelo)) cuerpo.temperature = 0;
    if (f.razonamiento) cuerpo.reasoning = { ...f.razonamiento, exclude: true };
    if (modo === 'json_schema') {
      cuerpo.response_format = { type: 'json_schema', json_schema: { name: p.esquema.nombre, strict: true, schema: p.esquema.schema } };
    } else if (modo === 'json_object') {
      cuerpo.response_format = { type: 'json_object' };
    }
    return cuerpo;
  }

  private async post(clave: string, cuerpo: unknown, tiempoMs: number): Promise<RespuestaHttp> {
    const res = await this.f(`${this.o.url ?? URL_OPENROUTER}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clave}`,
        'Content-Type': 'application/json',
        'X-OpenRouter-Title': this.o.titulo ?? 'BotMaker',
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(Math.max(1, tiempoMs)),
    });
    const texto = await res.text();
    let json: any;
    try {
      json = JSON.parse(texto);
    } catch {
      json = { error: { message: texto.slice(0, 200) } };
    }
    const ra = Number(res.headers.get('retry-after'));
    return { status: res.status, cuerpo: json, esperarS: Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) : null };
  }

  /** Espera antes de reintentar si el tiempo que queda alcanza para la espera y un intento más. */
  private async esperarSiDa(reintento: number, limite: number, esperarS: number | null = null): Promise<boolean> {
    if (reintento >= ESPERAS_MS.length) return false;
    const espera = Math.max(ESPERAS_MS[reintento]!, (esperarS ?? 0) * 1000);
    if (Date.now() + espera + 500 > limite) return false;
    await this.dormir(espera);
    return true;
  }

  private noSoportaFormato(r: RespuestaHttp): boolean {
    if (r.status !== 400 && r.status !== 404) return false;
    return /response_format|json_schema|structured|no endpoints found|parameter|temperature/i.test(JSON.stringify(r.cuerpo?.error ?? ''));
  }

  /**
   * El error del proveedor, corto y sin citas largas: por si algún proveedor repite parte del pedido en su mensaje.
   * Cuando OpenRouter dice solo «Provider returned error», lo que sirve está en metadata.raw (así se vio el freno de
   * Mistral en la prueba de motores).
   */
  private mensajeError(r: RespuestaHttp): string {
    const e = r.cuerpo?.error;
    const base = String(e?.message ?? 'sin detalle');
    const crudo = typeof e?.metadata?.raw === 'string' ? e.metadata.raw : '';
    const texto = crudo && /provider returned error/i.test(base) ? `${String(e?.metadata?.provider_name ?? 'el proveedor')}: ${crudo}` : base;
    const m = texto.replace(/(["'`«]).{20,}?\1/g, '[…]').replace(/[:,]?\s*https?:\/\/\S+/g, '').slice(0, 160);
    return `HTTP ${r.status}: ${m}`;
  }
}

function textoDe(contenido: unknown): string | null {
  if (typeof contenido === 'string') return contenido;
  if (Array.isArray(contenido)) return contenido.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('');
  return null;
}
