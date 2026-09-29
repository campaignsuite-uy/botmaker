/**
 * Un 360dialog en memoria para la demo y las pruebas: la misma forma que el cliente real (d360.ts), sin red ni cuentas.
 *
 *  - Acepta como clave cualquier texto de 20 letras, números, - o _ (salvo las que empiezan con "invalida") y guarda la
 *    dirección del aviso con sus encabezados, como 360dialog.
 *  - Lo que se manda queda en la memoria del «teléfono» de destino y avisa los estados (enviado, entregado cuando el
 *    teléfono lo mira, leído) a la misma dirección, con el mismo formato de Meta.
 *  - El teléfono de prueba (la página /publico/telefono de la demo) escribe como una persona: el simulado arma el aviso
 *    de Meta y lo entrega a la dirección configurada.
 *  - Las plantillas quedan en revisión y a los 15 segundos Meta «decide»: aprueba, salvo las que se llaman rechazar_….
 *  - Se puede revocar una clave, para probar un canal desconectado.
 *
 * Nada de esto sale de la memoria del servidor: al reiniciar, vuelve a la cuenta de la demo.
 */
import { leerPlantilla, plantillaAMeta, type MensajeWhatsapp, type NuevaPlantilla, type Plantilla, type PlantillaMeta } from '../dominio/whatsapp';
import type { Cliente360, ResultadoCliente } from './d360';
import { ENCABEZADO_SECRETO } from './d360';
import { CLAVE_DEMO, NUMERO_DEMO, PLANTILLAS_DEMO, SECRETO_DEMO } from './demo';

export type Entregar = (url: string, encabezados: Record<string, string>, cuerpo: string) => Promise<number>;

interface CuentaSim {
  revocada: boolean;
  webhook: { url: string; encabezados: Record<string, string>; desde: number } | null;
  plantillas: (PlantillaMeta & { creadaMs: number })[];
}

export interface MensajeTelefono {
  id: string;
  /** de: lo que escribió el teléfono; para: lo que le mandó la campaña. */
  sentido: 'de' | 'para';
  telefono: string;
  mensaje: MensajeWhatsapp | { type: 'entrante'; texto: string };
  estado: 'sent' | 'delivered' | 'read' | null;
  hora: string;
}

export type ContenidoTelefono =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'boton'; id: string; titulo: string }
  | { tipo: 'fila'; id: string; titulo: string }
  | { tipo: 'audio' }
  | { tipo: 'imagen'; pie?: string };

const DECISION_MS = 15_000;

export class Simulador360 implements Cliente360 {
  readonly simulado = true;
  private cuentas = new Map<string, CuentaSim>();
  private mensajes: (MensajeTelefono & { clave: string })[] = [];
  private siguiente = 1;
  private cola: Promise<unknown> = Promise.resolve();
  /** Cómo llega un aviso a la app: en la demo, directo a la ruta del webhook (el mismo código que con 360dialog). */
  entregar: Entregar | null = null;
  /** Para las pruebas: la hora del simulado. */
  reloj: () => number = () => Date.now();

  constructor(opciones: { demo?: { urlAviso: string } } = {}) {
    if (opciones.demo) {
      this.cuentas.set(CLAVE_DEMO, {
        revocada: false, webhook: { url: opciones.demo.urlAviso, encabezados: { [ENCABEZADO_SECRETO]: SECRETO_DEMO }, desde: 0 },
        plantillas: PLANTILLAS_DEMO.map((p) => ({ ...structuredClone(p), creadaMs: 0 })),
      });
    }
  }

  private cuenta(clave: string): CuentaSim | null {
    if (!/^[A-Za-z0-9_-]{20,256}$/.test(clave) || clave.startsWith('invalida')) return null;
    let c = this.cuentas.get(clave);
    if (!c) {
      c = { revocada: false, webhook: null, plantillas: [] };
      this.cuentas.set(clave, c);
    }
    return c.revocada ? null : c;
  }

  private sinClave<T>(): ResultadoCliente<T> {
    return { ok: false, error: 'clave_invalida', detalle: 'HTTP 401: Missing or invalid D360-API-KEY header (simulado)' };
  }

  // ── Lo que usa BotMaker (misma forma que 360dialog) ───────────────────────────────────────────

  async validarClave(clave: string): Promise<ResultadoCliente<true>> {
    return this.cuenta(clave) ? { ok: true, valor: true } : this.sinClave();
  }

  async configurarWebhook(clave: string, url: string, encabezados: Record<string, string>): Promise<ResultadoCliente<true>> {
    const c = this.cuenta(clave);
    if (!c) return this.sinClave();
    c.webhook = { url, encabezados: { ...encabezados }, desde: this.siguiente++ };
    return { ok: true, valor: true };
  }

  async enviar(clave: string, para: string, mensaje: MensajeWhatsapp): Promise<ResultadoCliente<string>> {
    const c = this.cuenta(clave);
    if (!c) return this.sinClave();
    if (!/^\d{7,15}$/.test(para)) return { ok: false, error: 'rechazado', detalle: 'HTTP 400 (131009): número inválido (simulado)' };
    if (mensaje.type === 'template') {
      const p = c.plantillas.find((x) => x.name === mensaje.template.name && x.language === mensaje.template.language.code);
      if (!p || (p.status ?? '').toUpperCase() !== 'APPROVED') return { ok: false, error: 'rechazado', detalle: 'HTTP 400 (132001): la plantilla no existe o no está aprobada (simulado)' };
    }
    const id = `wamid.sim.${this.siguiente++}`;
    this.mensajes.push({ id, clave, sentido: 'para', telefono: para, mensaje: structuredClone(mensaje), estado: 'sent', hora: new Date(this.reloj()).toISOString() });
    this.avisarEstados(clave, [{ id, estado: 'sent', para }]);
    return { ok: true, valor: id };
  }

  async plantillas(clave: string): Promise<ResultadoCliente<Plantilla[]>> {
    const c = this.cuenta(clave);
    if (!c) return this.sinClave();
    this.decidir(c);
    return { ok: true, valor: c.plantillas.map((p) => leerPlantilla(p)).filter((p): p is Plantilla => !!p) };
  }

  async crearPlantilla(clave: string, n: NuevaPlantilla): Promise<ResultadoCliente<{ id: string | null; estado: 'en_revision' }>> {
    const c = this.cuenta(clave);
    if (!c) return this.sinClave();
    if (c.plantillas.some((p) => p.name === n.nombre && p.language === n.idioma)) return { ok: false, error: 'rechazado', detalle: 'HTTP 400: ya existe una plantilla con ese nombre e idioma (simulado)' };
    const m = plantillaAMeta(n) as { name: string; language: string; category: string; parameter_format: string; components: { type: string; text: string }[] };
    const id = `tpl-sim-${this.siguiente++}`;
    c.plantillas.push({ id, name: m.name, language: m.language, category: m.category, parameter_format: m.parameter_format, status: 'PENDING', components: m.components, creadaMs: this.reloj() });
    return { ok: true, valor: { id, estado: 'en_revision' } };
  }

  async borrarPlantilla(clave: string, nombre: string): Promise<ResultadoCliente<true>> {
    const c = this.cuenta(clave);
    if (!c) return this.sinClave();
    c.plantillas = c.plantillas.filter((p) => p.name !== nombre);
    return { ok: true, valor: true };
  }

  /** Meta revisa las plantillas: pasados 15 segundos (o ya, con `ahora`), aprueba salvo las rechazar_…. */
  decidir(c: CuentaSim, ahora = false) {
    for (const p of c.plantillas) {
      if ((p.status ?? '').toUpperCase() !== 'PENDING') continue;
      if (!ahora && this.reloj() - p.creadaMs < DECISION_MS) continue;
      if ((p.name ?? '').startsWith('rechazar')) {
        p.status = 'REJECTED';
        p.rejected_reason = 'INVALID_FORMAT';
      } else {
        p.status = 'APPROVED';
      }
    }
  }

  decidirYa(clave: string) {
    const c = this.cuentas.get(clave);
    if (c) this.decidir(c, true);
  }

  // ── El teléfono de prueba ─────────────────────────────────────────────────────────────────────

  /** La clave cuyo aviso va a este bot (por el final de la dirección: /api/whatsapp/<id público>); la última configurada. */
  claveDeBot(idPublico: string): string | null {
    let mejor: { clave: string; desde: number } | null = null;
    for (const [clave, c] of this.cuentas) {
      if (c.webhook?.url.endsWith(`/api/whatsapp/${idPublico}`) && (!mejor || c.webhook.desde > mejor.desde)) mejor = { clave, desde: c.webhook.desde };
    }
    return mejor?.clave ?? null;
  }

  estaRevocada(clave: string): boolean {
    return !!this.cuentas.get(clave)?.revocada;
  }

  revocar(clave: string, revocada: boolean) {
    const c = this.cuentas.get(clave);
    if (c) c.revocada = revocada;
  }

  /** Una persona escribe desde su teléfono: el simulado arma el aviso de Meta y lo entrega. Devuelve el estado HTTP del aviso. */
  async escribir(clave: string, telefono: string, nombre: string | null, contenido: ContenidoTelefono): Promise<number> {
    const c = this.cuentas.get(clave);
    if (!c?.webhook || !this.entregar) return 0;
    const id = `wamid.sim.in.${this.siguiente++}`;
    const ts = String(Math.floor(this.reloj() / 1000));
    const base = { from: telefono, id, timestamp: ts };
    const mensaje =
      contenido.tipo === 'texto' ? { ...base, type: 'text', text: { body: contenido.texto } }
      : contenido.tipo === 'boton' ? { ...base, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: contenido.id, title: contenido.titulo } } }
      : contenido.tipo === 'fila' ? { ...base, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: contenido.id, title: contenido.titulo } } }
      : contenido.tipo === 'audio' ? { ...base, type: 'audio', audio: { id: 'media-sim', mime_type: 'audio/ogg' } }
      : { ...base, type: 'image', image: { id: 'media-sim', mime_type: 'image/jpeg', ...(contenido.pie ? { caption: contenido.pie } : {}) } };
    const texto = contenido.tipo === 'texto' ? contenido.texto : contenido.tipo === 'audio' ? '[audio]' : contenido.tipo === 'imagen' ? (contenido.pie || '[imagen]') : contenido.titulo;
    this.mensajes.push({ id, clave, sentido: 'de', telefono, mensaje: { type: 'entrante', texto }, estado: null, hora: new Date(this.reloj()).toISOString() });
    const cuerpo = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-sim', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp', metadata: { display_phone_number: NUMERO_DEMO, phone_number_id: 'pn-sim' },
        contacts: [{ profile: { name: nombre ?? '' }, wa_id: telefono }], messages: [mensaje],
      } }] }],
    };
    return this.entregar(c.webhook.url, c.webhook.encabezados, JSON.stringify(cuerpo));
  }

  /** Reenvía un aviso que ya se mandó (como hace 360dialog cuando no recibe respuesta): tiene que descartarse. */
  async reintentarUltimo(clave: string, telefono: string): Promise<number> {
    const c = this.cuentas.get(clave);
    const ultimo = [...this.mensajes].reverse().find((m) => m.clave === clave && m.telefono === telefono && m.sentido === 'de');
    if (!c?.webhook || !this.entregar || !ultimo || ultimo.mensaje.type !== 'entrante') return 0;
    const cuerpo = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-sim', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp', metadata: { display_phone_number: NUMERO_DEMO },
        contacts: [{ profile: { name: '' }, wa_id: telefono }],
        messages: [{ from: telefono, id: ultimo.id, timestamp: String(Math.floor(new Date(ultimo.hora).getTime() / 1000)), type: 'text', text: { body: ultimo.mensaje.texto } }],
      } }] }],
    };
    return this.entregar(c.webhook.url, c.webhook.encabezados, JSON.stringify(cuerpo));
  }

  /** La conversación de un teléfono con una cuenta. Al mirarla, lo que le llegó pasa a entregado y leído (y se avisa). */
  conversacion(clave: string, telefono: string, marcarLeido = true): MensajeTelefono[] {
    const lista = this.mensajes.filter((m) => m.clave === clave && m.telefono === telefono);
    if (marcarLeido) {
      const nuevos = lista.filter((m) => m.sentido === 'para' && m.estado !== 'read');
      for (const m of nuevos) m.estado = 'read';
      if (nuevos.length) this.avisarEstados(clave, nuevos.flatMap((m) => [{ id: m.id, estado: 'delivered' as const, para: telefono }, { id: m.id, estado: 'read' as const, para: telefono }]));
    }
    return lista.map(({ clave: _, ...m }) => structuredClone(m));
  }

  private avisarEstados(clave: string, estados: { id: string; estado: 'sent' | 'delivered' | 'read'; para: string }[]) {
    const c = this.cuentas.get(clave);
    if (!c?.webhook || !this.entregar) return;
    const { url, encabezados } = c.webhook;
    const ts = String(Math.floor(this.reloj() / 1000));
    const cuerpo = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-sim', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp', metadata: { display_phone_number: NUMERO_DEMO },
        statuses: estados.map((e) => ({ id: e.id, status: e.estado, timestamp: ts, recipient_id: e.para })),
      } }] }],
    });
    const entregar = this.entregar;
    // Como 360dialog: el aviso llega después, no en medio del envío.
    this.cola = this.cola.then(() => new Promise((r) => setTimeout(r, 0))).then(() => entregar(url, encabezados, cuerpo)).catch(() => 0);
  }

  /** Para las pruebas: espera a que se entreguen los avisos de estado pendientes. */
  async esperar(): Promise<void> {
    let antes: Promise<unknown> | null = null;
    while (antes !== this.cola) {
      antes = this.cola;
      await antes;
    }
  }
}

const g = globalThis as unknown as { __botsSimulador360?: Simulador360 };

/** El 360dialog simulado de este servidor (uno solo, como la demo en memoria). */
export function simulador360(urlAvisoDemo: string): Simulador360 {
  g.__botsSimulador360 ??= new Simulador360({ demo: { urlAviso: urlAvisoDemo } });
  return g.__botsSimulador360;
}
