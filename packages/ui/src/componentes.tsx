/**
 * Componentes de presentación de CampaignSuite. No saben nada del dominio: reciben textos, números ya
 * formateados y colores. Cualquier módulo los puede usar.
 */
import type { ReactNode } from 'react';

export type Estado = 'bien' | 'atencion' | 'flojo' | 'critico';
export const ETIQUETAS_ESTADO: Record<Estado, string> = { bien: 'Bien', atencion: 'Atención', flojo: 'Flojo', critico: 'Crítico' };
export const COLOR_ESTADO: Record<Estado, string> = { bien: 'var(--bien)', atencion: 'var(--atencion)', flojo: 'var(--flojo)', critico: 'var(--critico)' };

export function Encabezado(props: { ceja: ReactNode; titulo: string; enfasis?: string; bajada?: ReactNode; lado?: ReactNode }) {
  return (
    <div className="encabezado">
      <div className="encabezado__texto">
        <div className="ceja">{props.ceja}</div>
        <h1 className="titulo">
          {props.titulo} {props.enfasis ? <em>{props.enfasis}</em> : null}
        </h1>
        {props.bajada ? <p className="bajada">{props.bajada}</p> : null}
      </div>
      {props.lado ? <div className="encabezado__lado">{props.lado}</div> : null}
    </div>
  );
}

export function Caja(props: { titulo?: ReactNode; nota?: ReactNode; accion?: { texto: string; href: string }; destacada?: boolean; children: ReactNode; id?: string; className?: string }) {
  return (
    <section id={props.id} className={`caja${props.destacada ? ' caja--destacada' : ''}${props.className ? ` ${props.className}` : ''}`}>
      {props.titulo || props.nota || props.accion ? (
        <div className="caja__cabeza">
          {props.titulo ? <h2 className="caja__titulo">{props.titulo}</h2> : <span />}
          {props.accion ? (
            <a className="enlace-mayus" href={props.accion.href}>{props.accion.texto} →</a>
          ) : props.nota ? (
            <span className="caja__nota">{props.nota}</span>
          ) : null}
        </div>
      ) : null}
      {props.children}
    </section>
  );
}

export function Delta(props: { texto: string; sentido: 'sube' | 'baja' | 'igual' }) {
  return <span className={`delta delta--${props.sentido}`}>{props.texto}</span>;
}

export function EstadoTexto(props: { estado: Estado; texto?: string }) {
  return <span className={`mayus est-${props.estado}`}>● {props.texto ?? ETIQUETAS_ESTADO[props.estado]}</span>;
}

export function Pastilla(props: { estado: Estado; children: ReactNode; titulo?: string }) {
  return <span title={props.titulo} className={`pastilla est-${props.estado} fondo-${props.estado}`}>{props.children}</span>;
}

export function Kpi(props: { etiqueta: string; valor: ReactNode; delta?: { texto: string; sentido: 'sube' | 'baja' | 'igual' }; nota?: ReactNode; estado?: Estado; href?: string }) {
  const cuerpo = (
    <>
      <div className="kpi__etiqueta">{props.etiqueta}</div>
      <div className="kpi__valor">
        <span className="kpi__numero">{props.valor}</span>
        {props.delta ? <Delta {...props.delta} /> : null}
      </div>
      {props.nota ? <div className="kpi__nota">{props.nota}</div> : null}
      {props.estado ? <EstadoTexto estado={props.estado} /> : null}
    </>
  );
  return props.href ? <a className="kpi" href={props.href}>{cuerpo}</a> : <div className="kpi">{cuerpo}</div>;
}

export function CajaVeredicto(props: { letra: string; estado: Estado }) {
  return (
    <div className={`veredicto est-${props.estado} fondo-${props.estado}`}>
      <div className="kpi__etiqueta">Veredicto</div>
      <div className="fila" style={{ alignItems: 'baseline', gap: 10 }}>
        <span className="veredicto__letra">{props.letra}</span>
        <span className="mayus" style={{ fontSize: 12 }}>{ETIQUETAS_ESTADO[props.estado]}</span>
      </div>
    </div>
  );
}

export function CajaIndice(props: { etiqueta: string; valor: string; delta?: { texto: string; sentido: 'sube' | 'baja' | 'igual' }; nota?: string }) {
  return (
    <div className="kpi" style={{ padding: '18px 22px', minWidth: 190 }}>
      <div className="kpi__etiqueta">{props.etiqueta}</div>
      <div className="kpi__valor" style={{ gap: 10 }}>
        <span className="indice-grande">{props.valor}</span>
        {props.delta ? <Delta {...props.delta} /> : null}
      </div>
      {props.nota ? <div className="texto-mini apagado">{props.nota}</div> : null}
    </div>
  );
}

/** Barra horizontal 0–100 con marca opcional (por ejemplo, el rival que más aparece). */
export function Barra(props: { valor: number; color: string; marca?: number; fina?: boolean; etiqueta?: string }) {
  const v = Math.max(0, Math.min(100, props.valor));
  return (
    <div className={`barra${props.fina ? ' barra--fina' : ''}`} role="img" aria-label={props.etiqueta}>
      <div className="barra__relleno" style={{ width: `${v}%`, background: props.color }} />
      {props.marca !== undefined ? <div className="barra__marca" style={{ left: `${Math.max(0, Math.min(99.5, props.marca))}%` }} /> : null}
    </div>
  );
}

/** Barra de tono de tres segmentos (negativo, neutro, positivo), fracciones 0–1. */
export function BarraTono(props: { negativo: number; neutro: number; positivo: number; etiqueta?: string }) {
  return (
    <div className="barra-tono" role="img" aria-label={props.etiqueta}>
      <div style={{ width: `${props.negativo * 100}%`, background: 'var(--tono-neg)' }} />
      <div style={{ width: `${props.neutro * 100}%`, background: 'var(--tono-neu)' }} />
      <div style={{ width: `${props.positivo * 100}%`, background: 'var(--tono-pos)' }} />
    </div>
  );
}

export function BarraApilada(props: { segmentos: { valor: number; color: string; etiqueta: string }[] }) {
  const total = props.segmentos.reduce((a, s) => a + s.valor, 0) || 1;
  return (
    <div className="barra-apilada" role="img" aria-label={props.segmentos.map((s) => `${s.etiqueta} ${Math.round((100 * s.valor) / total)} %`).join(', ')}>
      {props.segmentos.filter((s) => s.valor > 0).map((s) => (
        <div key={s.etiqueta} title={`${s.etiqueta}: ${Math.round((100 * s.valor) / total)} %`} style={{ width: `${(100 * s.valor) / total}%`, background: s.color }} />
      ))}
    </div>
  );
}

export function Leyenda(props: { items: { texto: string; color: string; punteado?: boolean }[] }) {
  return (
    <div className="leyenda">
      {props.items.map((i) => (
        <span className="leyenda__item" key={i.texto}>
          <span style={{ color: i.color }}>{i.punteado ? '┅' : '━'}</span> {i.texto}
        </span>
      ))}
    </div>
  );
}

/** Pestañas que navegan por URL (sirven en componentes de servidor). */
export function Pestanas(props: { items: { texto: string; href: string; activa: boolean }[]; etiqueta: string }) {
  return (
    <nav className="pestanas" aria-label={props.etiqueta}>
      {props.items.map((i) => (
        <a key={i.href} className="pestana" href={i.href} aria-current={i.activa ? 'true' : undefined}>{i.texto}</a>
      ))}
    </nav>
  );
}

export function Punto(props: { color: string; redondo?: boolean; hueco?: boolean; titulo?: string }) {
  return (
    <span
      className={`punto${props.redondo ? ' punto--redondo' : ''}`}
      title={props.titulo}
      style={props.hueco ? { border: `1.5px solid ${props.color}` } : { background: props.color }}
    />
  );
}

export function Aviso(props: { tipo?: 'info' | 'ok' | 'error'; children: ReactNode }) {
  return <div role={props.tipo === 'error' ? 'alert' : 'status'} className={`aviso${props.tipo === 'ok' ? ' aviso--ok' : props.tipo === 'error' ? ' aviso--error' : ''}`}>{props.children}</div>;
}

export function PieCorrida(props: { children: ReactNode }) {
  return <div className="pie-corrida">{props.children}</div>;
}

/**
 * El rótulo de datos simulados de la barra de arriba: entero en la computadora y en corto en el celular (2.19); el
 * título lo dice entero.
 */
export function EtiquetaDatos({ etiqueta, titulo }: { etiqueta: string; titulo?: string }) {
  const corta = etiqueta.startsWith('Datos simulados') ? 'Simulados' : etiqueta.startsWith('Datos de prueba') ? 'Prueba' : etiqueta;
  return (
    <span className="etiqueta-demo" title={titulo ?? etiqueta}>
      <span className="solo-escritorio">{etiqueta}</span>
      <span className="solo-movil">{corta}</span>
    </span>
  );
}
