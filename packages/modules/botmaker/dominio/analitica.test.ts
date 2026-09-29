import { describe, expect, it } from 'vitest';
import {
  agregarPorHora, cierreDeConversacion, conversacionTerminada, horaDe, metricasDeEvento, porcentaje, resumirAnalitica, type DatosAnalitica, type EventoConContexto,
  type EventoParaAnalitica,
} from './analitica';

const ev = (nombre: string, cajaId: string | null = null, datos: Record<string, unknown> = {}): EventoParaAnalitica => ({ nombre, cajaId, datos });

describe('analítica: métricas de cada evento', () => {
  it('cada evento suma a lo suyo; los estados de WhatsApp y los valores raros no suman', () => {
    expect(metricasDeEvento(ev('sesion_iniciada'))).toEqual([{ metrica: 'conversacion', caja: '', clave: '' }]);
    expect(metricasDeEvento(ev('opcion_elegida', 'n_menu', { letra: 'C' }))).toEqual([{ metrica: 'opcion', caja: 'n_menu', clave: 'C' }]);
    expect(metricasDeEvento(ev('opcion_elegida', null, { aclaracion: 'propuesta' }))).toEqual([]);
    expect(metricasDeEvento(ev('interpretado', 'n_interpretar', { intencion: 'propuesta', tema: 'agua' })).map((x) => `${x.metrica}:${x.clave}`)).toEqual(['intencion:propuesta', 'tema:agua']);
    expect(metricasDeEvento(ev('interpretado', null, { intencion: 3, tema: null }))).toEqual([]);
    expect(metricasDeEvento(ev('regla', null, { regla: 'adjunto', intencion: 'no_entendible' }))).toEqual([{ metrica: 'intencion', caja: '', clave: 'no_entendible' }]);
    expect(metricasDeEvento(ev('respondido_con_base', 'n_consulta', { completa: false }))[0]).toEqual({ metrica: 'respuesta', caja: 'n_consulta', clave: 'sin_dato' });
    expect(metricasDeEvento(ev('estado_mensaje', null, { estado: 'leido' }))).toEqual([]);
    expect(metricasDeEvento(ev('caja_mostrada'))).toEqual([]);
  });

  it('suma por bot, canal, versión y hora (UTC)', () => {
    const e = (nombre: string, fecha: string, extra: Partial<EventoConContexto> = {}): EventoConContexto => ({ ...ev(nombre, 'n_menu', { letra: 'A' }), botId: 'b1', canal: 'web', versionId: 'v1', fecha, ...extra });
    const filas = agregarPorHora([
      e('caja_mostrada', '2026-10-01T10:05:00Z'), e('caja_mostrada', '2026-10-01T10:55:00Z'), e('caja_mostrada', '2026-10-01T11:00:00Z'),
      e('caja_mostrada', '2026-10-01T10:10:00Z', { canal: 'whatsapp' }), e('opcion_elegida', '2026-10-01T10:15:00Z'), e('caja_mostrada', '2026-10-01T10:20:00Z', { versionId: null }),
    ]);
    expect(filas.map((f) => `${f.canal}|${f.versionId}|${f.hora.slice(11, 13)}|${f.metrica}|${f.n}`)).toEqual([
      'web|null|10|caja|1', 'web|v1|10|caja|2', 'web|v1|10|opcion|1', 'web|v1|11|caja|1', 'whatsapp|v1|10|caja|1',
    ]);
    expect(horaDe('2026-10-01T10:59:59.999Z')).toBe('2026-10-01T10:00:00.000Z');
  });
});

describe('analítica: cómo terminó cada conversación', () => {
  const inicio = [ev('sesion_iniciada'), ev('caja_mostrada', 'n_bienvenida'), ev('caja_mostrada', 'n_menu')];

  it('una respuesta con base completa sin derivar es resuelta; el recorrido lleva las primeras cajas sin repetir', () => {
    const c = cierreDeConversacion([...inicio, ev('caja_mostrada', 'n_menu'), ev('texto_recibido'), ev('caja_mostrada', 'n_interpretar'), ev('interpretado', 'n_interpretar', { intencion: 'propuesta' }),
      ev('caja_mostrada', 'n_consulta'), ev('respondido_con_base', 'n_consulta', { completa: true }), ev('caja_mostrada', 'n_masayuda')], false);
    expect(c).toEqual({ resultado: 'resuelta', ultimaCaja: 'n_masayuda', recorrido: 'n_bienvenida>n_menu>n_interpretar>n_consulta' });
  });

  it('derivada sin que nadie escriba es derivada; si la atendió una persona, resuelta', () => {
    const d = [...inicio, ev('opcion_elegida', 'n_menu', { letra: 'E' }), ev('caja_mostrada', 'n_derivar'), ev('derivada', 'n_derivar'), ev('respondido_con_base', null, { completa: true })];
    expect(cierreDeConversacion(d, false).resultado).toBe('derivada');
    expect(cierreDeConversacion(d, true).resultado).toBe('resuelta');
  });

  it('un «gracias» después de consultar es un cierre de cortesía; un «hola» al empezar no', () => {
    expect(cierreDeConversacion([ev('regla', null, { regla: 'cortesia', intencion: 'cortesia' }), ...inicio], false).resultado).toBe('sin_resolver');
    expect(cierreDeConversacion([...inicio, ev('opcion_elegida', 'n_menu', { letra: 'B' }), ev('regla', null, { regla: 'cortesia', intencion: 'cortesia' })], false).resultado).toBe('resuelta');
    expect(cierreDeConversacion([...inicio, ev('respondido_con_base', 'n_consulta', { completa: false })], false)).toMatchObject({ resultado: 'sin_resolver', ultimaCaja: 'n_menu' });
    expect(cierreDeConversacion([], false)).toEqual({ resultado: 'sin_resolver', ultimaCaja: '', recorrido: '' });
  });

  it('termina a los 30 minutos sin movimiento', () => {
    expect(conversacionTerminada('2026-10-01T10:00:00Z', new Date('2026-10-01T10:29:59Z'))).toBe(false);
    expect(conversacionTerminada('2026-10-01T10:00:00Z', new Date('2026-10-01T10:30:00Z'))).toBe(true);
  });
});

describe('analítica: el resumen de la pantalla', () => {
  it('suma resultados, temas sin «ninguno», no entendidas, abandonos y opciones por caja', () => {
    const d: DatosAnalitica = {
      metricas: [
        { metrica: 'conversacion', caja: '', clave: '', n: 10 }, { metrica: 'texto', caja: '', clave: '', n: 8 },
        { metrica: 'intencion', caja: '', clave: 'propuesta', n: 5 }, { metrica: 'intencion', caja: '', clave: 'no_entendible', n: 2 }, { metrica: 'sin_motor', caja: 'n_interpretar', clave: '', n: 1 },
        { metrica: 'tema', caja: '', clave: 'agua', n: 3 }, { metrica: 'tema', caja: '', clave: 'ninguno', n: 4 }, { metrica: 'tema', caja: '', clave: 'salud', n: 3 },
        { metrica: 'caja', caja: 'n_menu', clave: '', n: 9 }, { metrica: 'opcion', caja: 'n_menu', clave: 'A', n: 4 }, { metrica: 'opcion', caja: 'n_menu', clave: 'E', n: 1 },
        { metrica: 'derivada', caja: 'n_derivar', clave: '', n: 2 },
      ],
      porDia: [],
      conversaciones: [
        { resultado: 'resuelta', ultimaCaja: 'n_masayuda', recorrido: 'n_bienvenida>n_menu', n: 5 },
        { resultado: 'sin_resolver', ultimaCaja: 'n_menu', recorrido: 'n_bienvenida>n_menu', n: 3 },
        { resultado: 'derivada', ultimaCaja: 'n_derivar', recorrido: 'n_bienvenida>n_menu>n_derivar', n: 1 },
      ],
      costos: null, actualizadaEn: null,
    };
    const r = resumirAnalitica(d);
    expect(r).toMatchObject({ conversaciones: 10, terminadas: 9, resultados: { resuelta: 5, derivada: 1, sin_resolver: 3 }, derivadas: 2, textos: 8, noEntendidas: 3 });
    expect(r.temas).toEqual([{ clave: 'agua', n: 3 }, { clave: 'salud', n: 3 }]);
    expect(r.recorridos[0]).toEqual({ recorrido: 'n_bienvenida>n_menu', n: 8 });
    expect(r.porCaja.get('n_menu')).toEqual({ visitas: 9, abandonos: 3, derivadas: 0, opciones: { A: 4, E: 1 } });
    expect(porcentaje(1, 3)).toBe('33 %');
    expect(porcentaje(1, 0)).toBe('—');
  });
});
