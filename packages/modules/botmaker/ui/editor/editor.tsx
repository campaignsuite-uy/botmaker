'use client';
/**
 * Editor de flujos: el diagrama de cada flujo (React Flow, distribuido solo con dagre), el inspector de la caja elegida,
 * deshacer y rehacer, el buscador por dirección (Ctrl+K o ⌘K) y lo que marca el validador en cada caja.
 *
 * El navegador no cambia la definición por su cuenta: cada acción manda operaciones al servidor y dibuja el borrador
 * que vuelve. Quien no edita ve el mismo diagrama y el inspector sin poder tocar nada.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import { buscarDireccion, TIPOS_CAJA, ETIQUETA_TIPO_CAJA, ubicar, type Definicion, type TipoCaja } from '../../dominio/definicion';
import { revisarBot, type Hallazgo } from '../../dominio/validador';
import { aplicarCambioBorrador, deshacerCambioBorrador } from '../../acciones/borrador';
import type { ResultadoBorrador } from '../../acciones/ejecutar-borrador';
import type { EstadoEditor } from '../../vistas/editor';
import type { NumerosDiagrama } from '../../vistas/analitica';
import { textoError } from '../../vistas/mensajes';
import { ANCHO_NODO, diagramaDeFlujo, operacionesCajaNueva, operacionesFlujoNuevo, salidaDeIndice, salidasConectables, type NodoDiagrama } from './modelo';
import { Inspector } from './inspector';

type Aviso = { tipo: 'ok' | 'error' | 'info'; texto: string; recargar?: boolean; detalles?: string[] } | null;

/** Las cajas que pasaron por el simulador con este borrador (las guarda el simulador en el navegador). */
function probadasGuardadas(versionId: string): Set<string> | undefined {
  try {
    const x = window.localStorage.getItem(`botmaker:probadas:${versionId}`);
    return x ? new Set(JSON.parse(x) as string[]) : undefined;
  } catch {
    return undefined;
  }
}

export function EditorFlujos(props: { e: EstadoEditor }) {
  return (
    <ReactFlowProvider>
      <Editor e={props.e} />
    </ReactFlowProvider>
  );
}

function Editor({ e }: { e: EstadoEditor }) {
  const [def, setDef] = useState<Definicion>(e.definicion);
  const [seq, setSeq] = useState(e.seq);
  const [pilas, setPilas] = useState({ deshacer: e.deshacer, rehacer: e.rehacer });
  const inicialFlujo = e.flujoInicial && e.definicion.flujos.some((f) => f.id === e.flujoInicial)
    ? e.flujoInicial
    : (e.cajaInicial && ubicar(e.definicion, e.cajaInicial)?.flujo.id) || e.definicion.flujos[0]!.id;
  const [flujoId, setFlujoId] = useState(inicialFlujo);
  const [seleccion, setSeleccion] = useState<string | null>(e.cajaInicial && ubicar(e.definicion, e.cajaInicial) ? e.cajaInicial : null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [ocupado, iniciar] = useTransition();
  const [verRevision, setVerRevision] = useState(false);
  const [verNumeros, setVerNumeros] = useState(e.numerosVisibles);
  const [probadas, setProbadas] = useState<Set<string> | undefined>(undefined);
  const [recorrido, setRecorrido] = useState<Set<string>>(new Set());
  useEffect(() => {
    setProbadas(probadasGuardadas(e.versionId));
    try {
      setRecorrido(new Set(JSON.parse(window.localStorage.getItem(`botmaker:recorrido:${e.versionId}`) ?? '[]') as string[]));
    } catch {
      // Sin almacenamiento del navegador: no se marca nada.
    }
  }, [e.versionId]);
  const limpiarRecorrido = () => {
    setRecorrido(new Set());
    try {
      window.localStorage.removeItem(`botmaker:recorrido:${e.versionId}`);
    } catch {
      // Nada que limpiar.
    }
  };

  const flujo = def.flujos.find((f) => f.id === flujoId) ?? def.flujos[0]!;
  const revision = useMemo(() => revisarBot(def, { probadas }), [def, probadas]);
  const sinProbar = revision.avisos.filter((h) => h.codigo === 'sin_probar').length;
  const avisosTotales = revision.avisos.length - sinProbar + e.avisosMotores.length;

  const aplicarResultado = useCallback((r: ResultadoBorrador, siOk?: (r: Extract<ResultadoBorrador, { ok: true }>) => void): boolean => {
    if (r.ok) {
      setDef(r.definicion);
      setSeq(r.seq);
      setPilas({ deshacer: r.deshacer, rehacer: r.rehacer });
      setAviso(r.otroCambio ? { tipo: 'info', texto: `Otra persona había cambiado el borrador: tu cambio se aplicó sobre lo último. ${r.resumen}.` } : { tipo: 'ok', texto: `${r.resumen}.` });
      siOk?.(r);
      return true;
    }
    setAviso({
      tipo: 'error',
      texto: r.mensaje ?? textoError(r.codigo),
      recargar: r.codigo === 'borrador_cambio',
      detalles: r.problemas?.map((x) => `${x.donde}: ${x.mensaje}`),
    });
    return false;
  }, []);

  const enviar = useCallback((ops: Record<string, unknown>[], siOk?: (r: Extract<ResultadoBorrador, { ok: true }>) => void) => new Promise<boolean>((listo) => {
    if (!ops.length) return listo(false);
    iniciar(async () => {
      const r = await aplicarCambioBorrador({ campanaId: e.campanaId, botId: e.botId, seq, operaciones: ops });
      listo(aplicarResultado(r, siOk));
    });
  }), [e.campanaId, e.botId, seq, aplicarResultado]);

  const deshacer = (rehacer: boolean) => iniciar(async () => {
    const r = await deshacerCambioBorrador({ campanaId: e.campanaId, botId: e.botId, seq, rehacer });
    aplicarResultado(r, (x) => {
      if (seleccion && !ubicar(x.definicion, seleccion)) setSeleccion(null);
      if (!x.definicion.flujos.some((f) => f.id === flujoId)) setFlujoId(x.definicion.flujos[0]!.id);
    });
  });

  const irA = useCallback((cajaId: string) => {
    const u = ubicar(def, cajaId);
    if (!u) return;
    setFlujoId(u.flujo.id);
    setSeleccion(cajaId);
  }, [def]);

  // Atajos: Ctrl+K / ⌘K busca por dirección; Ctrl+Z / ⌘Z deshace, con Mayúscula rehace (fuera de los campos de texto).
  const buscador = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        buscador.current?.focus();
        buscador.current?.select();
        return;
      }
      const enCampo = ev.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
      if (mod && ev.key.toLowerCase() === 'z' && !enCampo && e.editable && !ocupado) {
        ev.preventDefault();
        if (ev.shiftKey ? pilas.rehacer : pilas.deshacer) deshacer(ev.shiftKey);
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });

  return (
    <div className="ed">
      <BarraEditor
        def={def} flujoId={flujo.id} setFlujoId={(id) => { setFlujoId(id); setSeleccion(null); }} editable={e.editable} ocupado={ocupado}
        pilas={pilas} deshacer={deshacer} enviar={enviar} seleccion={seleccion} setSeleccion={setSeleccion} buscador={buscador} irA={irA}
        errores={revision.errores.length} avisos={avisosTotales} sinProbar={sinProbar} verRevision={verRevision} setVerRevision={setVerRevision}
        hrefSimulador={e.hrefSimulador} numeros={e.numeros ? { visibles: verNumeros, cambiar: () => setVerNumeros(!verNumeros), periodo: e.numeros.periodo } : null}
      />
      {aviso ? (
        <div className={`ed-aviso ed-aviso--${aviso.tipo}`} role={aviso.tipo === 'error' ? 'alert' : 'status'}>
          <span>{aviso.texto}</span>
          {aviso.detalles?.length ? <ul>{aviso.detalles.slice(0, 5).map((d) => <li key={d}>{d}</li>)}</ul> : null}
          {aviso.recargar ? <button type="button" className="boton boton--sec boton--chico" onClick={() => window.location.reload()}>Recargar</button> : null}
          <button type="button" className="ed-boton-icono" aria-label="Cerrar el aviso" onClick={() => setAviso(null)}>×</button>
        </div>
      ) : null}
      {verRevision ? <PanelRevision errores={revision.errores} avisos={revision.avisos} motores={e.avisosMotores} irA={(id) => { irA(id); setVerRevision(false); }} /> : null}
      <div className={`ed-cuerpo${seleccion ? ' ed-cuerpo--con-inspector' : ''}`}>
        <Diagrama def={def} flujoId={flujo.id} seleccion={seleccion} setSeleccion={setSeleccion} porCaja={revision.porCaja} recorrido={recorrido} editable={e.editable && !ocupado} enviar={enviar} irFlujo={setFlujoId} numeros={verNumeros ? e.numeros : null} />
        {seleccion && ubicar(def, seleccion) ? (
          <Inspector
            key={`${seleccion}:${seq}`} def={def} cajaId={seleccion} editable={e.editable} ocupado={ocupado}
            hallazgos={revision.porCaja.get(seleccion) ?? []} enviar={enviar} irA={irA} cerrar={() => setSeleccion(null)}
          />
        ) : null}
      </div>
      <p className="texto-mini apagado">
        Borrador v{e.numero} · cambio {seq}. {e.editable ? 'Clic en una caja para editarla; arrastrá desde un punto de salida hasta otra caja para conectarlas.' : 'Estás mirando: tu rol no cambia el borrador.'}
        {recorrido.size ? <> Las cajas marcadas son el último recorrido del simulador (<button type="button" className="ed-enlace" onClick={limpiarRecorrido}>dejar de marcarlo</button>).</> : null}
      </p>
    </div>
  );
}

// ── Barra ───────────────────────────────────────────────────────────────────────────────────────

function BarraEditor(p: {
  def: Definicion; flujoId: string; setFlujoId: (id: string) => void; editable: boolean; ocupado: boolean;
  pilas: { deshacer: string | null; rehacer: string | null }; deshacer: (rehacer: boolean) => void;
  enviar: (ops: Record<string, unknown>[], siOk?: (r: Extract<ResultadoBorrador, { ok: true }>) => void) => Promise<boolean>;
  seleccion: string | null; setSeleccion: (id: string | null) => void; buscador: React.RefObject<HTMLInputElement | null>; irA: (id: string) => void;
  errores: number; avisos: number; sinProbar: number; verRevision: boolean; setVerRevision: (x: boolean) => void; hrefSimulador: string;
  numeros: { visibles: boolean; cambiar: () => void; periodo: string } | null;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [noEsta, setNoEsta] = useState(false);
  const [panel, setPanel] = useState<'caja' | 'flujo' | 'renombrar' | null>(null);
  const [tipo, setTipo] = useState<TipoCaja>('mensaje');
  const [desde, setDesde] = useState('');
  const [nombre, setNombre] = useState('');
  const flujo = p.def.flujos.find((f) => f.id === p.flujoId)!;
  const cajaSel = p.seleccion ? ubicar(p.def, p.seleccion) : null;
  const conectables = cajaSel && cajaSel.flujo.id === p.flujoId ? salidasConectables(cajaSel.caja) : [];

  const buscar = () => {
    const b = buscarDireccion(p.def, busqueda);
    setNoEsta(!b);
    if (b) p.irA(b.cajaId);
  };
  const agregarCaja = () => {
    const d = desde !== '' && cajaSel ? { caja: cajaSel.caja.id, salida: conectables[Number(desde)]!.salida } : undefined;
    const { ops, cajaId } = operacionesCajaNueva(p.def, p.flujoId, tipo, d);
    void p.enviar(ops, () => {
      p.setSeleccion(cajaId);
      setPanel(null);
      setDesde('');
    });
  };
  const agregarFlujo = () => {
    if (!nombre.trim()) return;
    const { ops, flujoId } = operacionesFlujoNuevo(p.def, nombre);
    void p.enviar(ops, () => {
      p.setFlujoId(flujoId);
      setPanel(null);
      setNombre('');
    });
  };

  return (
    <div className="ed-barra">
      <div className="ed-flujos" role="tablist" aria-label="Flujos del bot">
        {p.def.flujos.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={f.id === p.flujoId} className="ed-flujo" onClick={() => p.setFlujoId(f.id)}>
            <span className="ed-flujo__num">{f.codigo}</span> {f.nombre}
          </button>
        ))}
        {p.editable ? <button type="button" className="ed-flujo ed-flujo--nuevo" onClick={() => setPanel(panel === 'flujo' ? null : 'flujo')}>+ Flujo</button> : null}
      </div>
      <div className="ed-herramientas">
        {p.editable ? (
          <>
            <button type="button" className="boton boton--chico" onClick={() => setPanel(panel === 'caja' ? null : 'caja')} disabled={p.ocupado}>+ Caja</button>
            <button type="button" className="boton boton--sec boton--chico" onClick={() => p.deshacer(false)} disabled={!p.pilas.deshacer || p.ocupado} title={p.pilas.deshacer ? `Deshacer: ${p.pilas.deshacer}` : 'Nada para deshacer'}>Deshacer</button>
            <button type="button" className="boton boton--sec boton--chico" onClick={() => p.deshacer(true)} disabled={!p.pilas.rehacer || p.ocupado} title={p.pilas.rehacer ? `Rehacer: ${p.pilas.rehacer}` : 'Nada para rehacer'}>Rehacer</button>
          </>
        ) : null}
        <form className="ed-buscar" role="search" onSubmit={(ev) => { ev.preventDefault(); buscar(); }}>
          <input ref={p.buscador} className="entrada entrada--chica" aria-label="Ir a una dirección" placeholder="Ir a 3.4 › B (Ctrl+K)" value={busqueda} onChange={(ev) => { setBusqueda(ev.target.value); setNoEsta(false); }} />
          {noEsta ? <span className="texto-mini est-critico">No existe</span> : null}
        </form>
        <button type="button" className={`ed-revision${p.errores ? ' ed-revision--error' : p.avisos ? ' ed-revision--aviso' : ''}`} aria-expanded={p.verRevision} onClick={() => p.setVerRevision(!p.verRevision)}>
          {p.errores === 1 ? '1 error' : `${p.errores} errores`} · {p.avisos === 1 ? '1 aviso' : `${p.avisos} avisos`}{p.sinProbar ? ` · ${p.sinProbar} sin probar` : ''}
        </button>
        {p.numeros ? (
          <button type="button" className={`boton boton--sec boton--chico${p.numeros.visibles ? ' ed-numeros--activo' : ''}`} aria-pressed={p.numeros.visibles} onClick={p.numeros.cambiar} title={`Conversaciones de verdad, del ${p.numeros.periodo} (UTC)`}>
            {p.numeros.visibles ? 'Ocultar los números' : 'Números (30 días)'}
          </button>
        ) : null}
                <a className="boton boton--sec boton--chico" href={p.hrefSimulador}>Probar en el simulador</a>
      </div>
      {panel === 'caja' ? (
        <div className="ed-panel" role="group" aria-label="Agregar una caja">
          <label className="campo">
            <span className="campo__etiqueta">Tipo de caja</span>
            <select className="entrada" value={tipo} onChange={(ev) => setTipo(ev.target.value as TipoCaja)}>
              {TIPOS_CAJA.filter((t) => t !== 'ir_a_flujo' || p.def.flujos.length > 1).map((t) => <option key={t} value={t}>{ETIQUETA_TIPO_CAJA[t]}</option>)}
            </select>
          </label>
          <label className="campo">
            <span className="campo__etiqueta">Conectarla desde</span>
            <select className="entrada" value={desde} onChange={(ev) => setDesde(ev.target.value)} disabled={!conectables.length}>
              <option value="">{conectables.length ? 'Sin conectar' : 'Elegí una caja del flujo para conectarla'}</option>
              {conectables.map((c, i) => <option key={i} value={i}>{cajaSel!.flujo.codigo}.{cajaSel!.caja.codigo} · {c.texto}</option>)}
            </select>
          </label>
          <div className="fila">
            <button type="button" className="boton boton--chico" onClick={agregarCaja} disabled={p.ocupado}>Agregar al flujo {flujo.codigo}</button>
            <button type="button" className="boton boton--sec boton--chico" onClick={() => setPanel(null)}>Cancelar</button>
          </div>
        </div>
      ) : null}
      {panel === 'flujo' ? (
        <form className="ed-panel" aria-label="Agregar un flujo" onSubmit={(ev) => { ev.preventDefault(); agregarFlujo(); }}>
          <label className="campo">
            <span className="campo__etiqueta">Nombre del flujo nuevo</span>
            <input className="entrada" value={nombre} maxLength={60} onChange={(ev) => setNombre(ev.target.value)} placeholder="Por ejemplo: Encuesta" autoFocus />
          </label>
          <div className="fila">
            <button type="submit" className="boton boton--chico" disabled={!nombre.trim() || p.ocupado}>Agregar flujo</button>
            <button type="button" className="boton boton--sec boton--chico" onClick={() => setPanel(null)}>Cancelar</button>
          </div>
        </form>
      ) : null}
      {p.editable ? <AccionesFlujo def={p.def} flujoId={p.flujoId} enviar={p.enviar} ocupado={p.ocupado} setFlujoId={p.setFlujoId} /> : null}
    </div>
  );
}

function AccionesFlujo(p: { def: Definicion; flujoId: string; ocupado: boolean; setFlujoId: (id: string) => void; enviar: (ops: Record<string, unknown>[], siOk?: () => void) => Promise<boolean> }) {
  const f = p.def.flujos.find((x) => x.id === p.flujoId)!;
  const [nombre, setNombre] = useState<string | null>(null);
  const [quitar, setQuitar] = useState(false);
  const tieneInicio = f.cajas.some((c) => c.id === p.def.inicio || c.id === p.def.textoLibre);
  return (
    <div className="ed-flujo-acciones texto-mini">
      {nombre === null ? (
        <button type="button" className="ed-enlace" onClick={() => setNombre(f.nombre)}>Renombrar el flujo {f.codigo}</button>
      ) : (
        <form className="fila" onSubmit={(ev) => { ev.preventDefault(); void p.enviar([{ tipo: 'renombrar_flujo', flujo: f.id, nombre }], () => setNombre(null)); }}>
          <input className="entrada entrada--chica" aria-label="Nombre del flujo" value={nombre} maxLength={60} onChange={(ev) => setNombre(ev.target.value)} autoFocus />
          <button type="submit" className="boton boton--chico" disabled={!nombre.trim() || p.ocupado}>Guardar</button>
          <button type="button" className="boton boton--sec boton--chico" onClick={() => setNombre(null)}>Cancelar</button>
        </form>
      )}
      {tieneInicio ? null : quitar ? (
        <span className="fila">
          <button type="button" className="boton boton--peligro boton--chico" disabled={p.ocupado} onClick={() => void p.enviar([{ tipo: 'quitar_flujo', flujo: f.id }], () => { setQuitar(false); p.setFlujoId(p.def.flujos[0]!.id); })}>Sí, quitar el flujo {f.codigo}</button>
          <button type="button" className="boton boton--sec boton--chico" onClick={() => setQuitar(false)}>No</button>
        </span>
      ) : (
        <button type="button" className="ed-enlace" onClick={() => setQuitar(true)}>Quitar el flujo</button>
      )}
    </div>
  );
}

function PanelRevision(p: { errores: Hallazgo[]; avisos: Hallazgo[]; motores: string[]; irA: (id: string) => void }) {
  const fila = (h: Hallazgo, i: number) => (
    <li key={i} className={`ed-hallazgo ed-hallazgo--${h.nivel}`}>
      {h.cajaId ? <button type="button" className="ed-enlace" onClick={() => p.irA(h.cajaId!)}>{h.donde}</button> : <strong>{h.donde}</strong>} · {h.mensaje}
    </li>
  );
  return (
    <div className="ed-panel ed-panel--revision" aria-label="Revisión del borrador">
      <div className="mayus">Errores: no se puede pedir publicar hasta resolverlos</div>
      {p.errores.length ? <ul className="ed-hallazgos">{p.errores.map(fila)}</ul> : <p className="texto-chico apagado">Ninguno.</p>}
      <div className="mayus">Avisos: conviene mirarlos</div>
      {p.avisos.length || p.motores.length ? (
        <ul className="ed-hallazgos">
          {p.avisos.filter((h) => h.codigo !== 'sin_probar').map(fila)}
          {p.avisos.some((h) => h.codigo === 'sin_probar') ? (
            <li className="ed-hallazgo ed-hallazgo--aviso">
              <strong>Sin probar en el simulador</strong> · {p.avisos.filter((h) => h.codigo === 'sin_probar').map((h, i) => (
                <span key={h.cajaId}>{i ? ', ' : ''}<button type="button" className="ed-enlace" onClick={() => p.irA(h.cajaId!)}>{h.donde}</button></span>
              ))}
            </li>
          ) : null}
          {p.motores.map((t) => <li key={t} className="ed-hallazgo ed-hallazgo--aviso"><strong>Motores</strong> · {t}</li>)}
        </ul>
      ) : <p className="texto-chico apagado">Ninguno.</p>}
    </div>
  );
}

// ── Diagrama ────────────────────────────────────────────────────────────────────────────────────

type DatosNodo = { n: NodoDiagrama; hallazgos: Hallazgo[]; irFlujo: (id: string) => void; recorrido: boolean; numeros: NumerosDiagrama['porCaja'][string] | null };

const NodoCaja = memo(function NodoCaja({ data, selected }: NodeProps<Node<DatosNodo>>) {
  const { n, hallazgos } = data;
  const errores = hallazgos.filter((h) => h.nivel === 'error').length;
  const avisos = hallazgos.length - errores;
  return (
    <div className={`ed-nodo ed-nodo--${n.tipo}${selected ? ' ed-nodo--elegido' : ''}${errores ? ' ed-nodo--error' : ''}${data.recorrido ? ' ed-nodo--recorrido' : ''}`} style={{ width: ANCHO_NODO, minHeight: n.alto }}>
      <Handle type="target" position={Position.Top} className="ed-punto ed-punto--entrada" />
      <div className="ed-nodo__cabeza">
        <span className="ed-nodo__dir">{n.direccion}</span>
        <span className="ed-nodo__tipo">{n.tipoTexto}</span>
        {n.inicioBot ? <span className="ed-marca" title="Aquí empieza cada conversación">Inicio</span> : null}
        {n.textoLibre ? <span className="ed-marca" title="Recibe lo que escriben cuando el bot no espera nada">Texto libre</span> : null}
        {!n.inicioBot && n.inicioFlujo ? <span className="ed-marca ed-marca--suave" title="Primera caja del flujo">1.ª</span> : null}
        {errores ? <span className="ed-cuenta ed-cuenta--error" title={`${errores} error(es)`}>{errores}</span> : null}
        {avisos ? <span className="ed-cuenta ed-cuenta--aviso" title={`${avisos} aviso(s)`}>{avisos}</span> : null}
        {data.numeros ? <span className="ed-num" title={data.numeros.titulo}>{data.numeros.visitas}{data.numeros.abandono ? ` · deja ${data.numeros.abandono}` : ''}</span> : null}
      </div>
      {n.nombre ? <div className="ed-nodo__nombre">{n.nombre}</div> : null}
      <div className="ed-nodo__resumen">{n.resumen}</div>
      <ul className="ed-nodo__salidas">
        {n.salidas.map((s) => (
          <li key={s.id} className="ed-salida">
            <span className="ed-salida__etiqueta">{s.letra ? <strong>{s.letra}</strong> : null} {s.letra ? s.etiqueta : <em>{s.etiqueta}</em>}{s.letra && data.numeros?.opciones[s.letra] ? <span className="ed-num ed-num--opcion"> {data.numeros.opciones[s.letra]}</span> : null}</span>
            {s.otroFlujo ? (
              <button type="button" className="ed-salida__destino ed-enlace nodrag" onClick={(ev) => { ev.stopPropagation(); data.irFlujo(s.otroFlujo!); }}>→ {s.destinoTexto}</button>
            ) : (
              <span className="ed-salida__destino">→ {s.destinoTexto}</span>
            )}
            <Handle type="source" position={Position.Right} id={s.id} className="ed-punto" />
          </li>
        ))}
      </ul>
    </div>
  );
});

const TIPOS_NODO = { caja: NodoCaja };

function Diagrama(p: {
  def: Definicion; flujoId: string; seleccion: string | null; setSeleccion: (id: string | null) => void; porCaja: Map<string, Hallazgo[]>;
  recorrido: Set<string>; editable: boolean; enviar: (ops: Record<string, unknown>[]) => Promise<boolean>; irFlujo: (id: string) => void;
  numeros: NumerosDiagrama | null;
}) {
  const { fitView, setCenter, getNode } = useReactFlow();
  const d = useMemo(() => diagramaDeFlujo(p.def, p.flujoId), [p.def, p.flujoId]);
  const nodes: Node<DatosNodo>[] = useMemo(() => d.nodos.map((n) => ({
    id: n.id, type: 'caja', position: { x: n.x, y: n.y }, width: ANCHO_NODO, height: n.alto, selected: n.id === p.seleccion,
    data: { n, hallazgos: p.porCaja.get(n.id) ?? [], irFlujo: p.irFlujo, recorrido: p.recorrido.has(n.id), numeros: p.numeros?.porCaja[n.id] ?? null },
  })), [d, p.seleccion, p.porCaja, p.irFlujo, p.recorrido, p.numeros]);
  const edges: Edge[] = useMemo(() => d.aristas.map((a) => {
    const marcada = a.desde === p.seleccion || a.hasta === p.seleccion;
    return {
      id: a.id, source: a.desde, sourceHandle: a.salida, target: a.hasta, type: 'smoothstep',
      className: marcada ? 'ed-arista ed-arista--marcada' : 'ed-arista', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    };
  }), [d, p.seleccion]);

  // Al cambiar de flujo, encuadra; al elegir una caja desde afuera (buscador, "ir a"), la centra.
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.1, maxZoom: 1, minZoom: 0.55 }), 30);
    return () => clearTimeout(t);
  }, [p.flujoId, fitView]);
  const ultimaCentrada = useRef<string | null>(null);
  useEffect(() => {
    if (!p.seleccion || ultimaCentrada.current === p.seleccion) return;
    ultimaCentrada.current = p.seleccion;
    const n = getNode(p.seleccion);
    if (n) setCenter(n.position.x + ANCHO_NODO / 2, n.position.y + (n.height ?? 120) / 2, { zoom: 1, duration: 250 });
  }, [p.seleccion, getNode, setCenter]);

  const conectar = useCallback((c: Connection) => {
    const caja = ubicar(p.def, c.source)?.caja;
    const i = Number(String(c.sourceHandle ?? '').replace('s-', ''));
    const salida = caja ? salidaDeIndice(caja, i) : null;
    if (!caja || salida === null || !c.target || c.target === c.source) return;
    void p.enviar([{ tipo: 'cambiar_ruta', caja: caja.id, salida, destino: c.target }]);
  }, [p]);

  return (
    <div className="ed-diagrama" aria-label="Diagrama del flujo">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={TIPOS_NODO} fitView fitViewOptions={{ padding: 0.1, maxZoom: 1, minZoom: 0.55 }} minZoom={0.2} maxZoom={1.5}
        nodesDraggable={false} nodesConnectable={p.editable} elementsSelectable edgesFocusable={false}
        onNodeClick={(_, n) => p.setSeleccion(n.id)} onPaneClick={() => p.setSeleccion(null)} onConnect={conectar}
        colorMode="dark"
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
