/**
 * Gráficos en SVG, sin librerías. Reglas (skill de visualización): líneas de 2 px, marcadores de
 * 8 px, grilla y ejes recesivos, un solo eje Y, leyenda cuando hay 2 o más series, el color sigue a la
 * entidad (nunca al puesto). Cada punto lleva <title> para el tooltip nativo.
 */

export interface SerieLinea {
  id: string;
  nombre: string;
  color: string;
  valores: (number | null)[];
  grosor?: number;
  punteada?: boolean;
  etiquetaFinal?: boolean;
  marcadores?: boolean;
}

export interface MarcaVertical {
  indice: number;
  texto: string;
}

export function Lineas(props: {
  etiquetasX: string[];
  series: SerieLinea[];
  min?: number;
  max?: number;
  invertido?: boolean;
  alto?: number;
  ancho?: number;
  formato?: (v: number) => string;
  marcas?: MarcaVertical[];
  titulo: string;
}) {
  const ancho = props.ancho ?? 1000;
  const alto = props.alto ?? 320;
  const m = { izq: 44, der: 120, arr: 28, aba: 34 };
  const w = ancho - m.izq - m.der;
  const h = alto - m.arr - m.aba;
  const valores = props.series.flatMap((s) => s.valores).filter((v): v is number => v !== null);
  const min = props.min ?? Math.floor(Math.min(...valores) / 10) * 10;
  const max = props.max ?? Math.ceil(Math.max(...valores) / 10) * 10;
  const n = props.etiquetasX.length;
  const x = (i: number) => m.izq + (n <= 1 ? w / 2 : (i * w) / (n - 1));
  const y = (v: number) => {
    const f = (v - min) / (max - min || 1);
    return m.arr + (props.invertido ? f * h : (1 - f) * h);
  };
  const fmt = props.formato ?? ((v: number) => String(Math.round(v)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * (max - min));
  // Etiquetas finales sin superponerse.
  const finales = props.series
    .filter((s) => s.etiquetaFinal)
    .map((s) => ({ s, v: [...s.valores].reverse().find((v): v is number => v !== null) }))
    .filter((e): e is { s: SerieLinea; v: number } => e.v !== undefined)
    .map((e) => ({ ...e, yy: y(e.v) }))
    .sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < finales.length; i++) if (finales[i]!.yy - finales[i - 1]!.yy < 14) finales[i]!.yy = finales[i - 1]!.yy + 14;

  return (
    <svg className="grafico" viewBox={`0 0 ${ancho} ${alto}`} width="100%" role="img" aria-label={props.titulo}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={m.izq} x2={m.izq + w} y1={y(t)} y2={y(t)} stroke="#1f1f1f" strokeWidth={1} />
          <text x={m.izq - 8} y={y(t) + 3} textAnchor="end" fontSize={10} fill="#888">{fmt(t)}</text>
        </g>
      ))}
      {props.etiquetasX.map((e, i) => (
        <text key={e + i} x={x(i)} y={alto - 10} textAnchor="middle" fontSize={10} fill="#888">{e}</text>
      ))}
      {(props.marcas ?? []).map((mk) => (
        <g key={mk.texto}>
          <line x1={x(mk.indice)} x2={x(mk.indice)} y1={m.arr - 10} y2={m.arr + h} stroke="#9b8cc8" strokeDasharray="3 4" strokeWidth={1} />
          <text x={x(mk.indice) + 4} y={m.arr - 14} fontSize={10} fill="#c4b5e8">{mk.texto}</text>
        </g>
      ))}
      {props.series.map((s) => {
        const pts = s.valores.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
        return (
          <g key={s.id}>
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth={s.grosor ?? 2} strokeDasharray={s.punteada ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
            {s.marcadores !== false
              ? s.valores.map((v, i) => (v === null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={s.grosor && s.grosor < 2 ? 3 : 4} fill={s.color} stroke="#0f0f0f" strokeWidth={2}>
                  <title>{`${s.nombre} · ${props.etiquetasX[i]}: ${fmt(v)}`}</title>
                </circle>
              )))
              : null}
          </g>
        );
      })}
      {finales.map((e) => (
        <text key={e.s.id} x={m.izq + w + 10} y={e.yy + 4} fontSize={11} fill={e.s.color === '#6b6b6b' ? '#888' : e.s.color} fontWeight={700}>
          {e.s.nombre} {fmt(e.v)}
        </text>
      ))}
    </svg>
  );
}

export function Sparkline(props: { valores: (number | null)[]; color: string; ancho?: number; alto?: number; min?: number; max?: number; marca?: number; titulo: string; referencia?: (number | null)[] }) {
  const ancho = props.ancho ?? 160;
  const alto = props.alto ?? 40;
  const vs = [...props.valores, ...(props.referencia ?? [])].filter((v): v is number => v !== null);
  const min = props.min ?? Math.min(...vs);
  const max = props.max ?? Math.max(...vs);
  const n = props.valores.length;
  const x = (i: number) => 4 + (n <= 1 ? 0 : (i * (ancho - 8)) / (n - 1));
  const y = (v: number) => 4 + (1 - (v - min) / (max - min || 1)) * (alto - 8);
  const linea = (xs: (number | null)[]) => xs.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
  const ultimo = [...props.valores].reverse().find((v): v is number => v !== null);
  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} width={ancho} height={alto} role="img" aria-label={props.titulo}>
      {props.marca !== undefined ? <line x1={x(props.marca)} x2={x(props.marca)} y1={0} y2={alto} stroke="#9b8cc8" strokeDasharray="2 3" /> : null}
      {props.referencia ? <polyline points={linea(props.referencia)} fill="none" stroke="#6b6b6b" strokeWidth={1.5} strokeDasharray="3 3" /> : null}
      <polyline points={linea(props.valores)} fill="none" stroke={props.color} strokeWidth={2} strokeLinejoin="round" />
      {ultimo !== undefined ? <circle cx={x(n - 1)} cy={y(ultimo)} r={3.5} fill={props.color} /> : null}
    </svg>
  );
}

/** Radar de 5 ejes 0–100: la serie propia sólida y la de referencia punteada. */
export function Radar(props: { ejes: string[]; propio: number[]; referencia: number[]; colorPropio: string; titulo: string }) {
  const cx = 130;
  const cy = 130;
  const R = 92;
  const n = props.ejes.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + Math.cos(a) * R * (v / 100), cy + Math.sin(a) * R * (v / 100)] as const;
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).map((c) => c.toFixed(1)).join(',')).join(' ');
  return (
    <svg className="grafico" width={400} height={260} viewBox="-70 0 400 260" role="img" aria-label={props.titulo} style={{ maxWidth: "100%", height: "auto" }}>
      {[25, 50, 75, 100].map((r) => <polygon key={r} points={poly(Array(n).fill(r))} fill="none" stroke="#2e2e2e" strokeWidth={1} />)}
      {props.ejes.map((_, i) => { const p = pt(i, 100); return <line key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke="#2e2e2e" strokeWidth={1} />; })}
      <polygon points={poly(props.referencia)} fill="rgba(255,255,255,0.05)" stroke="#bfbfbf" strokeWidth={1.5} strokeDasharray="4 3" />
      <polygon points={poly(props.propio)} fill="rgba(243,115,33,0.18)" stroke={props.colorPropio} strokeWidth={2} />
      {props.ejes.map((e, i) => {
        const p = pt(i, 122);
        const anchor = Math.abs(p[0] - cx) < 5 ? 'middle' : p[0] > cx ? 'start' : 'end';
        return <text key={e} x={p[0]} y={p[1] + 3} textAnchor={anchor} fill="#888" fontSize={9} letterSpacing={1.2}>{e.toUpperCase()}</text>;
      })}
    </svg>
  );
}

/** Celda de mapa de calor secuencial (un solo tono, opacidad según el valor 0–1). */
export function CeldaCalor(props: { valor: number; maximo: number; color: string; texto: string; titulo?: string }) {
  const f = props.maximo ? Math.max(0.06, Math.min(1, props.valor / props.maximo)) : 0;
  return (
    <div className="celda-calor" title={props.titulo} style={{ background: `color-mix(in srgb, ${props.color} ${Math.round(f * 85)}%, #141414)`, color: f > 0.55 ? '#000' : '#fff' }}>
      {props.texto}
    </div>
  );
}

/** Celda divergente: negativo rojo, positivo verde, neutro gris; intensidad por magnitud. */
export function CeldaDivergente(props: { valor: number; maximo: number; texto: string; resaltada?: boolean; titulo?: string }) {
  const f = Math.min(1, Math.abs(props.valor) / (props.maximo || 1));
  const color = props.valor < 0 ? '#f06a6a' : '#4cc38a';
  return (
    <div className="celda-calor" title={props.titulo} style={{ background: `color-mix(in srgb, ${color} ${Math.round(f * 70)}%, #1a1a1a)`, color: f > 0.6 ? '#000' : '#fff', outline: props.resaltada ? '2px solid #fff' : undefined, outlineOffset: -2 }}>
      {props.texto}
    </div>
  );
}
