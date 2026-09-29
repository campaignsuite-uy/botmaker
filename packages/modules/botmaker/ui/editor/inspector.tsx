'use client';
/**
 * Inspector de una caja: sus campos según el tipo, el texto de su contenido, sus opciones y adónde va cada salida.
 * "Guardar" manda todo junto como un solo cambio (se deshace junto). Quien no edita ve lo mismo sin poder tocarlo.
 */
import { useState, type ReactNode } from 'react';
import {
  DESCRIPCION_TIPO_CAJA, ETIQUETA_TIPO_CAJA, idsUsados, LIMITES, nuevoId, ubicar, type Caja, type CajaDe, type Condicion, type Definicion,
} from '../../dominio/definicion';
import type { Hallazgo } from '../../dominio/validador';
import { destinosPosibles, direccionDe, operacionesDeFormulario, usosDeContenido, valoresDeCaja, type ValoresCaja } from './modelo';

type Enviar = (ops: Record<string, unknown>[]) => Promise<boolean>;

interface Props {
  def: Definicion;
  cajaId: string;
  editable: boolean;
  ocupado: boolean;
  hallazgos: Hallazgo[];
  enviar: Enviar;
  irA: (cajaId: string) => void;
  cerrar: () => void;
}

const NINGUNO = '';

export function Inspector(p: Props) {
  const u = ubicar(p.def, p.cajaId);
  const inicial = u ? valoresDeCaja(p.def, u.caja) : null;
  const [v, setV] = useState<ValoresCaja | null>(inicial);
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);
  if (!u || !v || !inicial) return <div className="ed-inspector"><p className="texto-chico apagado">Esa caja ya no existe.</p></div>;
  const { flujo, caja } = u;
  const ops = operacionesDeFormulario(p.def, caja.id, v);
  const cambiado = ops.length > 0;
  const ro = !p.editable;
  const poner = (k: string, valor: unknown) => setV({ ...v, [k]: valor });
  const ponerVarios = (x: Record<string, unknown>) => setV({ ...v, ...x });
  const destinos = destinosPosibles(p.def, flujo, caja.id);

  // Si se guarda, el editor vuelve a armar el inspector con el borrador nuevo (cambia su key).
  const guardar = () => p.enviar(ops);
  const accion = (x: Record<string, unknown>[]) => p.enviar(x);

  return (
    <div className="ed-inspector" aria-label={`Caja ${flujo.codigo}.${caja.codigo}`}>
      <div className="ed-inspector__cabeza">
        <div>
          <div className="subtitulo">{flujo.codigo}.{caja.codigo} · {ETIQUETA_TIPO_CAJA[caja.tipo]}</div>
          <div className="texto-mini apagado">{DESCRIPCION_TIPO_CAJA[caja.tipo]}</div>
        </div>
        <button type="button" className="ed-boton-icono" onClick={p.cerrar} aria-label="Cerrar el inspector">×</button>
      </div>

      {p.hallazgos.length ? (
        <ul className="ed-hallazgos">
          {p.hallazgos.map((h, i) => <li key={i} className={`ed-hallazgo ed-hallazgo--${h.nivel}`}>{h.mensaje}</li>)}
        </ul>
      ) : null}

      <Campo etiqueta="Nombre interno" ayuda="Lo ve el equipo en el diagrama; la persona no.">
        <input className="entrada" value={v.nombre} maxLength={60} disabled={ro} onChange={(e) => poner('nombre', e.target.value)} />
      </Campo>

      {'contenidoTexto' in v && v.contenidoTexto !== undefined ? (
        <ContenidoCaja def={p.def} caja={caja} v={v} ro={ro} poner={setV} separar={accion} ocupado={p.ocupado} />
      ) : null}

      <CamposPorTipo def={p.def} caja={caja} v={v} ro={ro} poner={poner} ponerVarios={ponerVarios} destinos={destinos} irA={p.irA} />

      {'opciones' in caja ? (
        <Opciones caja={caja} v={v} ro={ro} destinos={destinos} poner={setV} accion={accion} ocupado={p.ocupado} irA={p.irA} def={p.def} />
      ) : null}

      {!ro ? (
        <>
          <div className="fila ed-inspector__guardar">
            <button type="button" className="boton" disabled={!cambiado || p.ocupado} onClick={guardar}>Guardar cambios</button>
            <button type="button" className="boton boton--sec" disabled={!cambiado || p.ocupado} onClick={() => setV(inicial)}>Descartar</button>
            {cambiado ? <span className="texto-mini apagado">{ops.length === 1 ? '1 cambio' : `${ops.length} cambios`} sin guardar</span> : null}
          </div>
          <div className="ed-inspector__acciones">
            <div className="mayus apagado">Esta caja</div>
            <div className="fila">
              {flujo.inicio !== caja.id ? (
                <button type="button" className="boton boton--sec boton--chico" disabled={p.ocupado} onClick={() => accion([{ tipo: 'cambiar_inicio_flujo', flujo: flujo.id, caja: caja.id }])}>Empezar el flujo acá</button>
              ) : null}
              {p.def.inicio !== caja.id && (caja.tipo === 'mensaje' || caja.tipo === 'menu') ? (
                <button type="button" className="boton boton--sec boton--chico" disabled={p.ocupado} onClick={() => accion([{ tipo: 'cambiar_inicio', caja: caja.id }])}>Empezar el bot acá</button>
              ) : null}
              {p.def.textoLibre !== caja.id && (caja.tipo === 'interpretar' || caja.tipo === 'respuesta_base') ? (
                <button type="button" className="boton boton--sec boton--chico" disabled={p.ocupado} onClick={() => accion([{ tipo: 'cambiar_texto_libre', caja: caja.id }])}>Que reciba los textos libres</button>
              ) : null}
              {confirmarQuitar ? (
                <>
                  <button type="button" className="boton boton--peligro boton--chico" disabled={p.ocupado} onClick={async () => { if (await accion([{ tipo: 'quitar_caja', caja: caja.id }])) p.cerrar(); }}>Sí, quitar {flujo.codigo}.{caja.codigo}</button>
                  <button type="button" className="boton boton--sec boton--chico" onClick={() => setConfirmarQuitar(false)}>No</button>
                </>
              ) : (
                <button type="button" className="boton boton--sec boton--chico" disabled={p.ocupado} onClick={() => setConfirmarQuitar(true)}>Quitar la caja</button>
              )}
            </div>
            {confirmarQuitar ? <p className="texto-mini apagado">Lo que apuntaba a esta caja queda sin destino. Se puede deshacer.</p> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: ReactNode; children: ReactNode }) {
  return (
    <label className="campo ed-campo">
      <span className="campo__etiqueta">{etiqueta}</span>
      {children}
      {ayuda ? <span className="texto-mini apagado">{ayuda}</span> : null}
    </label>
  );
}

/** Selector de destino: una caja del flujo o "Termina". */
function Destino(props: { valor: string | null; destinos: { valor: string; texto: string }[]; ro: boolean; onCambio: (d: string | null) => void; etiqueta?: string; irA?: (id: string) => void }) {
  return (
    <span className="ed-destino">
      <select className="entrada" aria-label={props.etiqueta ?? 'Destino'} value={props.valor ?? NINGUNO} disabled={props.ro} onChange={(e) => props.onCambio(e.target.value || null)}>
        <option value={NINGUNO}>Termina (el próximo texto va a interpretar)</option>
        {props.destinos.map((d) => <option key={d.valor} value={d.valor}>{d.texto}</option>)}
        {props.valor && !props.destinos.some((d) => d.valor === props.valor) ? <option value={props.valor}>{props.valor}</option> : null}
      </select>
      {props.valor && props.irA ? <button type="button" className="ed-boton-icono" title="Ir a esa caja" aria-label="Ir a esa caja" onClick={() => props.irA!(props.valor!)}>→</button> : null}
    </span>
  );
}

function ContenidoCaja(props: { def: Definicion; caja: Caja; v: ValoresCaja; ro: boolean; poner: (v: ValoresCaja) => void; separar: Enviar; ocupado: boolean }) {
  const { def, v } = props;
  const contenidoId = v.contenido as string;
  const usos = usosDeContenido(def, contenidoId);
  const texto = v.contenidoTexto ?? '';
  const botones = props.caja.tipo === 'mensaje' || (props.caja.tipo === 'menu' && v.modo === 'botones');
  return (
    <div className="ed-contenido">
      <Campo etiqueta="Qué dice el bot" ayuda={
        <>
          {texto.length} de {LIMITES.texto} caracteres. Variables: {'{{bot.candidato}}'}, {'{{contacto.nombre}}'}…
          {usos.length > 1 ? <> Este texto se usa también en {usos.filter((x) => x !== direccionDe(def, props.caja.id)).join(', ')}: cambiarlo lo cambia en todas.</> : null}
          {botones ? ' Con botones, WhatsApp muestra el texto arriba de los botones.' : ''}
        </>
      }>
        <textarea className="entrada ed-texto" value={texto} maxLength={LIMITES.texto} disabled={props.ro} rows={4} onChange={(e) => props.poner({ ...v, contenidoTexto: e.target.value })} />
      </Campo>
      {!props.ro ? (
        <div className="fila">
          <label className="texto-mini apagado ed-otro-contenido">
            Usar otro texto de la biblioteca:{' '}
            <select className="entrada entrada--chica" value={contenidoId} onChange={(e) => props.poner({ ...v, contenido: e.target.value, contenidoTexto: def.contenidos.find((c) => c.id === e.target.value)?.texto ?? '' })}>
              {def.contenidos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          {usos.length > 1 ? (
            <button type="button" className="boton boton--sec boton--chico" disabled={props.ocupado} onClick={() => {
              const nuevo = nuevoId('c', idsUsados(def));
              const nombre = `${def.contenidos.find((c) => c.id === contenidoId)?.nombre ?? 'Texto'} (${direccionDe(def, props.caja.id)})`.slice(0, 60);
              void props.separar([
                { tipo: 'agregar_contenido', contenido: { id: nuevo, nombre, texto: texto.trim() || '…' } },
                { tipo: 'editar_caja', caja: props.caja.id, cambios: { contenido: nuevo } },
              ]);
            }}>Separar: texto propio para esta caja</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Opciones(props: {
  def: Definicion; caja: CajaDe<'mensaje'> | CajaDe<'menu'>; v: ValoresCaja; ro: boolean; destinos: { valor: string; texto: string }[];
  poner: (v: ValoresCaja) => void; accion: Enviar; ocupado: boolean; irA: (id: string) => void;
}) {
  const { caja, v } = props;
  const opciones = v.opciones ?? [];
  const lista = caja.tipo === 'menu' && v.modo === 'lista';
  const tope = lista ? LIMITES.opcionesLista : LIMITES.botones;
  const largo = lista ? LIMITES.textoOpcionLista : LIMITES.textoBoton;
  const cambiar = (i: number, x: Partial<(typeof opciones)[number]>) => props.poner({ ...v, opciones: opciones.map((o, j) => (j === i ? { ...o, ...x } : o)) });
  return (
    <fieldset className="ed-opciones">
      <legend className="campo__etiqueta">{lista ? 'Opciones de la lista' : 'Botones'} ({opciones.length} de {tope})</legend>
      {opciones.map((o, i) => (
        <div key={o.letra} className="ed-opcion">
          <span className="ed-opcion__letra" title={`${direccionDe(props.def, caja.id)} › ${o.letra}`}>{o.letra}</span>
          <div className="ed-opcion__campos">
            <input className="entrada" aria-label={`Texto de la opción ${o.letra}`} value={o.texto} disabled={props.ro} onChange={(e) => cambiar(i, { texto: e.target.value })} />
            <span className={`texto-mini ${o.texto.length > largo ? 'est-critico' : 'apagado'}`}>{o.texto.length}/{largo}</span>
            {lista ? <input className="entrada" aria-label={`Descripción de la opción ${o.letra}`} placeholder="Descripción (opcional)" value={o.descripcion ?? ''} maxLength={LIMITES.descripcionOpcionLista} disabled={props.ro} onChange={(e) => cambiar(i, { descripcion: e.target.value })} /> : null}
            <Destino etiqueta={`Destino de la opción ${o.letra}`} valor={o.destino} destinos={props.destinos} ro={props.ro} onCambio={(d) => cambiar(i, { destino: d })} irA={props.irA} />
          </div>
          {!props.ro && opciones.length > (caja.tipo === 'menu' ? 1 : 0) ? (
            <button type="button" className="ed-boton-icono" aria-label={`Quitar la opción ${o.letra}`} title="Quitar la opción" disabled={props.ocupado} onClick={() => props.accion([{ tipo: 'quitar_opcion', caja: caja.id, letra: o.letra }])}>×</button>
          ) : null}
        </div>
      ))}
      {!props.ro && opciones.length < (caja.tipo === 'menu' ? LIMITES.opcionesLista : LIMITES.botones) ? (
        <button type="button" className="boton boton--sec boton--chico" disabled={props.ocupado} onClick={() => props.accion([{ tipo: 'agregar_opcion', caja: caja.id, texto: `Opción ${opciones.length + 1}`, destino: null }])}>
          Agregar {lista ? 'opción' : 'botón'}
        </button>
      ) : null}
      {!lista && opciones.length > LIMITES.botones ? <p className="texto-mini est-critico">WhatsApp admite {LIMITES.botones} botones: pasá el menú a lista.</p> : null}
    </fieldset>
  );
}

function CamposPorTipo(props: { def: Definicion; caja: Caja; v: ValoresCaja; ro: boolean; poner: (k: string, x: unknown) => void; ponerVarios: (x: Record<string, unknown>) => void; destinos: { valor: string; texto: string }[]; irA: (id: string) => void }) {
  const { def, caja, v, ro, poner, destinos, irA } = props;
  const destino = (k: string, etiqueta: string, ayuda?: string) => (
    <Campo etiqueta={etiqueta} ayuda={ayuda}>
      <Destino etiqueta={etiqueta} valor={(v[k] as string | null) ?? null} destinos={destinos} ro={ro} onCambio={(d) => poner(k, d)} irA={irA} />
    </Campo>
  );
  switch (caja.tipo) {
    case 'mensaje':
      return (caja.opciones.length ? null : destino('siguiente', 'Después sigue en'));
    case 'menu':
      return (
        <>
          <Campo etiqueta="Cómo se muestran">
            <select className="entrada" value={v.modo as string} disabled={ro} onChange={(e) => poner('modo', e.target.value)}>
              <option value="botones">Botones (hasta 3, de 20 caracteres)</option>
              <option value="lista">Lista (hasta 10 opciones, de 24 caracteres)</option>
            </select>
          </Campo>
          {destino('textoLibre', 'Si en vez de tocar escriben', 'Normalmente, una caja de interpretar. "Termina" usa la del bot.')}
        </>
      );
    case 'interpretar':
      return <Rutas def={def} v={v} ro={ro} poner={poner} destinos={destinos} irA={irA} />;
    case 'respuesta_base': {
      const temas = (v.temas as string[]) ?? [];
      return (
        <>
          <Campo etiqueta="Pregunta fija (opcional)" ayuda="Si se llega desde un botón, contesta esta pregunta. Sin pregunta, espera que la persona escriba.">
            <input className="entrada" value={(v.pregunta as string) ?? ''} maxLength={300} disabled={ro} onChange={(e) => poner('pregunta', e.target.value.trim() ? e.target.value : undefined)} />
          </Campo>
          <fieldset className="ed-temas">
            <legend className="campo__etiqueta">Material que usa</legend>
            <span className="texto-mini apagado">{temas.length ? `Solo ${temas.length === 1 ? 'el tema elegido' : `los ${temas.length} temas elegidos`}.` : 'Todo el material del bot.'}</span>
            <div className="ed-chips">
              {def.temas.map((t) => (
                <label key={t.id} className="chip ed-chip">
                  <input type="checkbox" checked={temas.includes(t.id)} disabled={ro} onChange={(e) => poner('temas', e.target.checked ? [...temas, t.id] : temas.filter((x) => x !== t.id))} />
                  {t.nombre}
                </label>
              ))}
            </div>
          </fieldset>
          {destino('conDato', 'Después de responder')}
          {destino('sinDato', 'Si no tiene el dato', 'El bot dice que no tiene el dato (con el canal de consultas) y sigue acá.')}
        </>
      );
    }
    case 'pedir_dato': {
      const variables = def.variables.filter((x) => x.nombre.startsWith('contacto.'));
      return (
        <>
          <div className="grilla-2">
            <Campo etiqueta="Qué dato">
              <select className="entrada" value={v.dato as string} disabled={ro} onChange={(e) => poner('dato', e.target.value)}>
                <option value="nombre">Nombre</option>
                <option value="correo">Correo</option>
                <option value="telefono">Teléfono</option>
                <option value="texto">Un texto</option>
              </select>
            </Campo>
            <Campo etiqueta="Lo guarda en">
              <select className="entrada" value={v.variable as string} disabled={ro} onChange={(e) => poner('variable', e.target.value)}>
                {variables.map((x) => <option key={x.nombre} value={x.nombre}>{x.nombre}</option>)}
              </select>
            </Campo>
          </div>
          <Campo etiqueta="Reintentos si no es válido">
            <select className="entrada" value={String(v.reintentos)} disabled={ro} onChange={(e) => poner('reintentos', Number(e.target.value))}>
              {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Campo>
          {destino('siguiente', 'Con el dato, sigue en')}
          {destino('siFalla', 'Si no lo da, sigue en')}
        </>
      );
    }
    case 'condicion':
      return <Casos def={def} v={v} ro={ro} poner={poner} destinos={destinos} irA={irA} />;
    case 'derivacion':
      return (
        <>
          <Campo etiqueta="Motivo (lo ve el equipo en la bandeja)">
            <input className="entrada" value={(v.motivo as string) ?? ''} maxLength={120} disabled={ro} onChange={(e) => poner('motivo', e.target.value)} />
          </Campo>
          {destino('alVolver', 'Cuando el equipo la devuelve al bot')}
        </>
      );
    case 'ir_a_flujo': {
      const otros = def.flujos.filter((f) => f.cajas.every((c) => c.id !== caja.id));
      const elegido = def.flujos.find((f) => f.id === v.flujo);
      return (
        <>
          <Campo etiqueta="Flujo">
            <select className="entrada" value={v.flujo as string} disabled={ro} onChange={(e) => {
              const f = def.flujos.find((x) => x.id === e.target.value);
              props.ponerVarios({ flujo: e.target.value, ...(f ? { caja: f.inicio } : {}) });
            }}>
              {otros.map((f) => <option key={f.id} value={f.id}>{f.codigo} · {f.nombre}</option>)}
            </select>
          </Campo>
          {elegido ? (
            <Campo etiqueta="Caja">
              <span className="ed-destino">
                <select className="entrada" value={v.caja as string} disabled={ro} onChange={(e) => poner('caja', e.target.value)}>
                  {destinosPosibles(def, elegido).map((d) => <option key={d.valor} value={d.valor}>{d.texto}</option>)}
                </select>
                <button type="button" className="ed-boton-icono" title="Ir a esa caja" aria-label="Ir a esa caja" onClick={() => irA(v.caja as string)}>→</button>
              </span>
            </Campo>
          ) : null}
        </>
      );
    }
  }
}

function Rutas(props: { def: Definicion; v: ValoresCaja; ro: boolean; poner: (k: string, x: unknown) => void; destinos: { valor: string; texto: string }[]; irA: (id: string) => void }) {
  const rutas = (props.v.rutas as Record<string, string | null>) ?? {};
  const libres = props.def.intenciones.filter((i) => !(i.id in rutas));
  const [nueva, setNueva] = useState('');
  return (
    <>
      <Campo etiqueta="Si no entiende" ayuda="Antes dice el mensaje de sistema de no entendí.">
        <Destino etiqueta="Si no entiende" valor={(props.v.noEntendio as string | null) ?? null} destinos={props.destinos} ro={props.ro} onCambio={(d) => props.poner('noEntendio', d)} irA={props.irA} />
      </Campo>
      <fieldset className="ed-opciones">
        <legend className="campo__etiqueta">Rutas propias de esta caja</legend>
        <span className="texto-mini apagado">Cada intención va a su destino (en Intenciones y temas). Acá se cambia solo para esta caja.</span>
        {Object.entries(rutas).map(([i, d]) => (
          <div key={i} className="ed-opcion">
            <span className="ed-opcion__letra ed-opcion__letra--ancha">{props.def.intenciones.find((x) => x.id === i)?.nombre ?? i}</span>
            <div className="ed-opcion__campos">
              <Destino etiqueta={`Destino de ${i}`} valor={d} destinos={props.destinos} ro={props.ro} onCambio={(x) => props.poner('rutas', { ...rutas, [i]: x })} irA={props.irA} />
            </div>
            {!props.ro ? <button type="button" className="ed-boton-icono" aria-label={`Quitar la ruta de ${i}`} onClick={() => { const r = { ...rutas }; delete r[i]; props.poner('rutas', r); }}>×</button> : null}
          </div>
        ))}
        {!props.ro && libres.length ? (
          <div className="fila">
            <select className="entrada entrada--chica" aria-label="Intención para una ruta propia" value={nueva} onChange={(e) => setNueva(e.target.value)}>
              <option value="">Elegí una intención…</option>
              {libres.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
            </select>
            <button type="button" className="boton boton--sec boton--chico" disabled={!nueva} onClick={() => { props.poner('rutas', { ...rutas, [nueva]: null }); setNueva(''); }}>Agregar ruta</button>
          </div>
        ) : null}
      </fieldset>
    </>
  );
}

function Casos(props: { def: Definicion; v: ValoresCaja; ro: boolean; poner: (k: string, x: unknown) => void; destinos: { valor: string; texto: string }[]; irA: (id: string) => void }) {
  const casos = (props.v.casos as { si: Condicion; destino: string | null }[]) ?? [];
  const variables = props.def.variables.map((x) => x.nombre);
  const cambiar = (i: number, x: Partial<(typeof casos)[number]>) => props.poner('casos', casos.map((c, j) => (j === i ? { ...c, ...x } : c)));
  return (
    <>
      <fieldset className="ed-opciones">
        <legend className="campo__etiqueta">Casos, en orden: el primero que se cumple</legend>
        {casos.map((c, i) => (
          <div key={i} className="ed-opcion">
            <span className="ed-opcion__letra">{i + 1}</span>
            <div className="ed-opcion__campos">
              <select className="entrada" aria-label={`Tipo del caso ${i + 1}`} value={c.si.tipo === 'horario' ? (c.si.dentro ? 'dentro' : 'fuera') : 'variable'} disabled={props.ro} onChange={(e) => {
                const t = e.target.value;
                cambiar(i, { si: t === 'variable' ? { tipo: 'variable', variable: variables[0] ?? 'contacto.nombre', operador: 'existe' } : { tipo: 'horario', dentro: t === 'dentro' } });
              }}>
                <option value="dentro">En horario de atención</option>
                <option value="fuera">Fuera de horario</option>
                <option value="variable">Según una variable</option>
              </select>
              {c.si.tipo === 'variable' ? (
                <div className="fila">
                  <select className="entrada entrada--chica" aria-label="Variable" value={c.si.variable} disabled={props.ro} onChange={(e) => cambiar(i, { si: { ...(c.si as Extract<Condicion, { tipo: 'variable' }>), variable: e.target.value } })}>
                    {variables.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                  <select className="entrada entrada--chica" aria-label="Operador" value={c.si.operador} disabled={props.ro} onChange={(e) => cambiar(i, { si: { ...(c.si as Extract<Condicion, { tipo: 'variable' }>), operador: e.target.value as 'existe' } })}>
                    <option value="existe">tiene valor</option>
                    <option value="no_existe">no tiene valor</option>
                    <option value="igual">es</option>
                    <option value="distinto">no es</option>
                    <option value="contiene">contiene</option>
                  </select>
                  {c.si.operador !== 'existe' && c.si.operador !== 'no_existe' ? (
                    <input className="entrada entrada--chica" aria-label="Valor" value={c.si.valor ?? ''} disabled={props.ro} onChange={(e) => cambiar(i, { si: { ...(c.si as Extract<Condicion, { tipo: 'variable' }>), valor: e.target.value } })} />
                  ) : null}
                </div>
              ) : null}
              <Destino etiqueta={`Destino del caso ${i + 1}`} valor={c.destino} destinos={props.destinos} ro={props.ro} onCambio={(d) => cambiar(i, { destino: d })} irA={props.irA} />
            </div>
            {!props.ro && casos.length > 1 ? <button type="button" className="ed-boton-icono" aria-label={`Quitar el caso ${i + 1}`} onClick={() => props.poner('casos', casos.filter((_, j) => j !== i))}>×</button> : null}
          </div>
        ))}
        {!props.ro && casos.length < 10 ? (
          <button type="button" className="boton boton--sec boton--chico" onClick={() => props.poner('casos', [...casos, { si: { tipo: 'horario', dentro: true }, destino: null }])}>Agregar caso</button>
        ) : null}
      </fieldset>
      <Campo etiqueta="Si no se cumple ninguno">
        <Destino etiqueta="Si no se cumple ninguno" valor={(props.v.sino as string | null) ?? null} destinos={props.destinos} ro={props.ro} onCambio={(d) => props.poner('sino', d)} irA={props.irA} />
      </Campo>
    </>
  );
}
