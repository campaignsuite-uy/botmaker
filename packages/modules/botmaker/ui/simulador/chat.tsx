'use client';
/**
 * El chat del simulador: la conversación con el borrador como la vería la persona (widget web o WhatsApp) y, debajo
 * de cada respuesta, por qué salió. La sesión vive en el navegador y viaja en cada turno.
 *
 * Guarda en el navegador las cajas por las que pasó (el editor avisa las que faltan probar) y el último recorrido (el
 * editor lo marca en el diagrama).
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import { turnoSimulador } from '../../acciones/simulador';
import type { ResultadoSimulador } from '../../acciones/ejecutar-simulador';
import type { Decision, Evento, MensajeSalida } from '../../dominio/motor';
import type { EstadoSimulador } from '../../vistas/simulador';
import { textoError } from '../../vistas/mensajes';

type Ok = Extract<ResultadoSimulador, { ok: true }>;
type Turno = { quien: 'persona'; texto: string } | { quien: 'bot'; mensajes: MensajeSalida[]; decision: Decision; eventos: Evento[]; seq: number };

const EVENTOS: Partial<Record<Evento['nombre'], string>> = {
  derivada: 'Pasó al equipo: el bot deja de contestar hasta que la devuelvan',
  baja: 'Pidió no recibir más mensajes',
  dato_guardado: 'Guardó un dato',
  dato_invalido: 'El dato no es válido',
  sin_motor: 'Sin motor disponible: siguió con los menús',
  tope_pasos: 'Cortó un ciclo entre cajas',
  aclaracion: 'Las dos lecturas no coinciden: pregunta con dos botones',
  boton_viejo: 'Botón de antes: se tomó como texto',
  sin_dato: 'El material no tiene el dato',
  mensaje_en_derivada: 'La conversación está con el equipo: el bot no contesta',
  dato_cortado: 'El validador de datos cortó la respuesta: tenía un dato que no está en lo citado',
  tramite_electoral: 'Trámite electoral que el material no cubre: derivó al organismo electoral',
};

function guardarRecorrido(versionId: string, recorrido: string[]) {
  try {
    const clave = `botmaker:probadas:${versionId}`;
    const probadas = new Set<string>(JSON.parse(window.localStorage.getItem(clave) ?? '[]') as string[]);
    for (const id of recorrido) probadas.add(id);
    window.localStorage.setItem(clave, JSON.stringify([...probadas]));
    window.localStorage.setItem(`botmaker:recorrido:${versionId}`, JSON.stringify(recorrido));
  } catch {
    // Sin almacenamiento del navegador: el simulador anda igual.
  }
}

const usd = (x: number) => (x === 0 ? 'USD 0' : x < 0.0001 ? 'menos de USD 0,0001' : `USD ${x.toFixed(4).replace('.', ',')}`);

export function ChatSimulador({ s }: { s: EstadoSimulador }) {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [sesion, setSesion] = useState<unknown>(null);
  const [texto, setTexto] = useState('');
  const [vista, setVista] = useState<'web' | 'whatsapp'>('web');
  const [horario, setHorario] = useState<'dentro' | 'fuera'>('dentro');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [cambio, setCambio] = useState<number | null>(null);
  const [ocupado, iniciar] = useTransition();
  const fin = useRef<HTMLDivElement>(null);

  const enviar = (entrada: unknown, mostrar?: string, desde: { sesion: unknown; turnos: Turno[] } = { sesion, turnos }) => {
    setError(null);
    const antes = mostrar ? [...desde.turnos, { quien: 'persona' as const, texto: mostrar }] : desde.turnos;
    setTurnos(antes);
    iniciar(async () => {
      const r = await turnoSimulador({ campanaId: s.campanaId, botId: s.botId, sesion: desde.sesion, entrada, horario, variables });
      if (!r.ok) {
        setError(textoError(r.codigo));
        return;
      }
      const ok = r as Ok;
      setSesion(ok.sesion);
      setTurnos([...antes, { quien: 'bot', mensajes: ok.mensajes, decision: ok.decision, eventos: ok.eventos, seq: ok.seq }]);
      if (ok.seq !== s.seq) setCambio(ok.seq);
      guardarRecorrido(s.versionId, ok.decision.recorrido);
    });
  };
  const reiniciar = () => enviar({ tipo: 'inicio' }, undefined, { sesion: null, turnos: [] });

  // La conversación arranca sola al abrir (una sola vez, aunque React monte dos veces en desarrollo).
  const arranco = useRef(false);
  useEffect(() => {
    if (arranco.current) return;
    arranco.current = true;
    reiniciar();
  });
  useEffect(() => fin.current?.scrollIntoView({ block: 'nearest' }), [turnos.length]);

  const ultimoBot = [...turnos].reverse().find((t) => t.quien === 'bot');
  const derivada = (sesion as { estado?: string } | null)?.estado === 'derivada';

  return (
    <div className={`sim sim--${vista}`}>
      <div className="sim-controles">
        <label className="campo">
          <span className="campo__etiqueta">Vista</span>
          <select className="entrada entrada--chica" value={vista} onChange={(e) => setVista(e.target.value as 'web')}>
            <option value="web">Widget web</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>
        <label className="campo">
          <span className="campo__etiqueta">Horario de atención</span>
          <select className="entrada entrada--chica" value={horario} onChange={(e) => setHorario(e.target.value as 'dentro')}>
            <option value="dentro">Dentro del horario</option>
            <option value="fuera">Fuera del horario</option>
          </select>
        </label>
        <details className="sim-variables">
          <summary className="texto-chico">Datos de la persona</summary>
          {s.variablesContacto.map((v) => (
            <label key={v} className="campo">
              <span className="campo__etiqueta">{v}</span>
              <input className="entrada entrada--chica" value={variables[v] ?? ''} onChange={(e) => setVariables({ ...variables, [v]: e.target.value })} placeholder="(vacío)" />
            </label>
          ))}
          <span className="texto-mini apagado">Se aplican desde el próximo mensaje.</span>
        </details>
        <button type="button" className="boton boton--sec boton--chico" onClick={reiniciar} disabled={ocupado}>Reiniciar</button>
      </div>
      {s.simulado ? <p className="texto-mini apagado">Esta instalación usa el motor simulado (demo): entiende por palabras parecidas y no cuesta nada. Con los motores reales, cada mensaje que pasa por un motor tiene costo.</p> : null}
      {cambio !== null ? <p className="texto-mini est-atencion">El borrador cambió (va por el cambio {cambio}): el simulador ya usa lo último.</p> : null}

      <div className="sim-chat" aria-live="polite">
        {turnos.map((t, i) => (t.quien === 'persona' ? (
          <div key={i} className="sim-fila sim-fila--persona"><div className="sim-burbuja sim-burbuja--persona">{t.texto}</div></div>
        ) : (
          <div key={i} className="sim-grupo">
            {t.mensajes.map((m, j) => <MensajeBot key={j} m={m} vista={vista} activo={t === ultimoBot && !ocupado && !derivada} elegir={(letra, titulo) => enviar({ tipo: 'opcion', cajaId: m.opcionesDe, letra, titulo }, titulo)} />)}
            {!t.mensajes.length ? <div className="texto-mini apagado sim-nada">(el bot no dijo nada)</div> : null}
            <PorQue t={t} s={s} />
          </div>
        )))}
        {ocupado ? <div className="texto-mini apagado sim-escribiendo">escribiendo…</div> : null}
        {error ? <div className="aviso aviso--error" role="alert">{error}</div> : null}
        <div ref={fin} />
      </div>

      <form className="sim-entrada" onSubmit={(e) => { e.preventDefault(); if (texto.trim()) { enviar({ tipo: 'texto', texto: texto.trim() }, texto.trim()); setTexto(''); } }}>
        <input className="entrada" aria-label="Mensaje" placeholder={derivada ? 'La conversación está con el equipo' : 'Escribí como si fueras la persona…'} value={texto} maxLength={2000} onChange={(e) => setTexto(e.target.value)} />
        <button type="submit" className="boton" disabled={ocupado || !texto.trim()}>Enviar</button>
      </form>
    </div>
  );
}

function MensajeBot({ m, vista, activo, elegir }: { m: MensajeSalida; vista: 'web' | 'whatsapp'; activo: boolean; elegir: (letra: string, titulo: string) => void }) {
  const [abierta, setAbierta] = useState(false);
  const lista = m.modo === 'lista';
  return (
    <div className="sim-fila">
      <div className="sim-burbuja">
        {m.texto ? <div className="sim-texto">{m.texto}</div> : null}
        {m.opciones?.length && lista && vista === 'whatsapp' ? (
          <button type="button" className="sim-boton sim-boton--lista" onClick={() => setAbierta(!abierta)} disabled={!activo}>Ver opciones</button>
        ) : null}
      </div>
      {m.opciones?.length && (!lista || vista === 'web' || abierta) ? (
        <div className={`sim-opciones${lista ? ' sim-opciones--lista' : ''}`}>
          {m.opciones.map((o) => (
            <button key={o.letra} type="button" className="sim-boton" disabled={!activo} onClick={() => elegir(o.letra, o.texto)}>
              <span>{o.texto}</span>
              {o.descripcion ? <span className="texto-mini apagado">{o.descripcion}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PorQue({ t, s }: { t: Extract<Turno, { quien: 'bot' }>; s: EstadoSimulador }) {
  const d = t.decision;
  const caja = (id: string) => s.cajas[id];
  const eventos = t.eventos.map((e) => EVENTOS[e.nombre]).filter((x): x is string => !!x);
  const nombre = (id: string | null) => (id ? s.intenciones[id] ?? id : 'sin respuesta');
  return (
    <details className="sim-porque">
      <summary className="texto-mini">
        Por qué: {d.recorrido.length ? d.recorrido.map((id) => caja(id)?.direccion ?? id).join(' → ') : 'sin cajas'}
        {d.intencion ? ` · ${nombre(d.intencion)}` : ''}{d.costoUsd ? ` · ${usd(d.costoUsd)}` : ''}
      </summary>
      <dl className="sim-decision texto-mini">
        <dt>Recorrido</dt>
        <dd>{d.recorrido.length ? d.recorrido.map((id, i) => {
          const c = caja(id);
          return <span key={i}>{i ? ' → ' : ''}<a href={`${s.hrefFlujos}?${new URLSearchParams({ flujo: c?.flujo ?? '', caja: id })}`}>{c ? `${c.direccion} ${c.texto}` : id}</a></span>;
        }) : '—'}</dd>
        {d.regla ? <><dt>Regla antes del motor</dt><dd>{d.regla} (sin IA, sin costo)</dd></> : null}
        {d.intencion ? <><dt>Intención</dt><dd>{nombre(d.intencion)}{d.tema ? ` · tema ${s.temas[d.tema] ?? d.tema}` : ''}</dd></> : null}
        {d.lectura ? (
          <>
            <dt>Doble lectura</dt>
            <dd>{({ coinciden: 'coinciden', distintas: 'no coinciden', una: 'respondió uno solo', ninguna: 'no respondió ninguno' } as Record<string, string>)[d.lectura.resultado] ?? d.lectura.resultado}: principal {nombre(d.lectura.principal)}, respaldo {nombre(d.lectura.respaldo)}</dd>
          </>
        ) : null}
        {d.motor ? <><dt>Motor</dt><dd>{s.motores[d.motor] ?? d.motor}</dd></> : null}
        {d.secciones?.length ? <><dt>Secciones del material</dt><dd>{d.secciones.join(', ')}</dd></> : null}
        {d.corte?.length ? <><dt>Cortó el validador</dt><dd className="est-critico">{d.corte.join(' · ')}</dd></> : null}
        <dt>Costo</dt><dd>{usd(d.costoUsd)}</dd>
        {eventos.length ? <><dt>Qué pasó</dt><dd>{eventos.join(' · ')}</dd></> : null}
      </dl>
    </details>
  );
}
