import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { nucleoMemoria, reiniciarNucleoMemoria } from '@campaignsuite/platform/memoria';
import { RepositorioDemo } from '../datos/demo/repositorio-demo';
import { CANDIDATA_DEMO } from '../datos/demo/semilla';
import { direccion, ubicar, validarDefinicion, type Definicion } from '../dominio/definicion';
import { rolEfectivo } from './comun';
import { ejecutarCrearBot, type ContextoNucleo } from './ejecutar-bots';
import { ejecutarCambio, ejecutarCrearBorrador, ejecutarDeshacer, ejecutarDeshacerFormulario, ejecutarFormulario, ejecutarImportarYaml, leerBorrador, yamlDelBorrador, type ResultadoBorrador } from './ejecutar-borrador';

const CAMPANA = 'c-pa-2029';
const BOT = 'bot-demo-1';
let repo: RepositorioDemo;
const como = (personaId: string): ContextoNucleo => ({ repo, rol: rolEfectivo(nucleoMemoria(), personaId, CAMPANA), personaId, campanaId: CAMPANA });
const fd = (x: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(x)) f.set(k, v);
  return f;
};
const definicion = async (botId = BOT): Promise<Definicion> => {
  const l = await leerBorrador(repo, botId);
  if ('codigo' in l) throw new Error(l.codigo);
  return l.definicion;
};
const seqDe = async (botId = BOT) => (await repo.borrador(botId))!.seq;
const bien = (r: ResultadoBorrador) => {
  if (!r.ok) throw new Error(`${r.codigo}: ${r.mensaje ?? ''}`);
  return r;
};
const texto = (d: Definicion) => JSON.stringify(d);
const renombrarMenu = (nombre: string) => ({ tipo: 'editar_caja', caja: 'n_menu', cambios: { nombre } });

beforeEach(() => {
  reiniciarNucleoMemoria();
  repo = new RepositorioDemo();
});

describe('versión 1 y borrador', () => {
  it('los bots de la demo arrancan con su borrador v1 armado con la plantilla', async () => {
    const b = await repo.borrador(BOT);
    expect(b).toMatchObject({ numero: 1, estado: 'borrador', seq: 0 });
    expect(validarDefinicion(b!.definicion).ok).toBe(true);
    expect((await definicion()).identidad.candidato.nombre).toBe(CANDIDATA_DEMO);
  });

  it('crear un bot arma su versión 1 con el candidato del formulario, el trato y los temas del mercado', async () => {
    const s = await ejecutarCrearBot(como('p-lucia'), fd({ nombre: 'Nuevo', caso: 'politico', mercado: 'UY', trato: 'tu', candidato: ' Carla Méndez ', partido: '', clave: randomUUID() }));
    expect(s.tipo).toBe('ok');
    const d = await definicion(s.botId!);
    expect(d.identidad.candidato.nombre).toBe('Carla Méndez');
    expect(d.identidad.partido).toBeNull();
    expect(d.temas.map((t) => t.id)).not.toContain('css_pensiones');
    expect(d.contenidos.find((c) => c.id === 'c_bienvenida')?.texto).toMatch(/[Pp]uedes|te /);
    expect((await repo.versiones(s.botId!)).map((v) => v.numero)).toEqual([1]);
    expect((await ejecutarCrearBot(como('p-lucia'), fd({ nombre: 'x', caso: 'electoral', mercado: 'PA', trato: 'usted', candidato: '', partido: '', clave: randomUUID() }))).codigo).toBe('candidato_vacio');
  });

  it('un bot sin versiones arma el borrador con la plantilla; con versiones, lo copia; dos veces no crea dos', async () => {
    const id = await repo.crearBot(CAMPANA, { nombre: 'Viejo', caso: 'electoral', mercado: 'PA', trato: 'usted' }, randomUUID(), 'p-lucia');
    expect((await leerBorrador(repo, id) as { codigo: string }).codigo).toBe('sin_borrador');
    expect((await ejecutarCrearBorrador(como('p-lucia'), { botId: id, candidato: '', partido: '' })).codigo).toBe('candidato_vacio');
    expect((await ejecutarCrearBorrador(como('p-andres'), { botId: id, candidato: 'X', partido: '' })).codigo).toBe('sin_permiso');
    expect((await ejecutarCrearBorrador(como('p-lucia'), { botId: id, candidato: 'Pedro Gil', partido: 'Partido Uno' })).tipo).toBe('ok');
    const v1 = await repo.borrador(id);
    expect((await ejecutarCrearBorrador(como('p-lucia'), { botId: id, candidato: '', partido: '' })).tipo).toBe('ok');
    expect((await repo.borrador(id))!.id).toBe(v1!.id);
    expect((await definicion(id)).identidad.partido?.nombre).toBe('Partido Uno');
  });
});

describe('cambios del borrador', () => {
  it('el editor aplica un cambio: sube el seq, guarda el historial y ofrece deshacer', async () => {
    const r = bien(await ejecutarCambio(como('p-lucia'), { botId: BOT, seq: 0, operaciones: [renombrarMenu('Menú principal')], origen: 'editor' }));
    expect(r).toMatchObject({ seq: 1, numero: 1, resumen: 'Editó la caja 1.2', deshacer: 'Editó la caja 1.2', rehacer: null, otroCambio: false });
    expect((ubicar(await definicion(), 'n_menu')!.caja as { nombre: string }).nombre).toBe('Menú principal');
    const h = await repo.cambios(r.versionId);
    expect(h).toEqual([expect.objectContaining({ seq: 1, origen: 'editor', resumen: 'Editó la caja 1.2', personaId: 'p-lucia', objetivo: null })]);
    expect((await repo.cambio(r.versionId, 1))?.operaciones).toEqual([renombrarMenu('Menú principal')]);
  });

  it('agente, lector y sin acceso no cambian; el repositorio lo vuelve a exigir', async () => {
    for (const p of ['p-andres', 'p-equipo', 'p-mariana']) {
      expect((await ejecutarCambio(como(p), { botId: BOT, seq: 0, operaciones: [renombrarMenu('x')], origen: 'editor' }) as { codigo: string }).codigo).toBe('sin_permiso');
    }
    const trucho = { ...como('p-andres'), rol: 'editor' as const };
    expect((await ejecutarCambio(trucho, { botId: BOT, seq: 0, operaciones: [renombrarMenu('x')], origen: 'editor' }) as { codigo: string }).codigo).toBe('sin_permiso');
    expect(await seqDe()).toBe(0);
  });

  it('un cambio que deja el bot inválido no se guarda y dice dónde está el problema', async () => {
    const antes = texto(await definicion());
    const r = await ejecutarCambio(como('p-lucia'), { botId: BOT, seq: 0, operaciones: [{ tipo: 'cambiar_ruta', caja: 'n_menu', salida: { opcion: 'A' }, destino: 'n_consulta' }], origen: 'editor' });
    expect(r).toMatchObject({ ok: false, codigo: 'definicion_invalida' });
    expect(!r.ok && r.problemas?.[0]).toMatchObject({ codigo: 'destino_otro_flujo', donde: '1.2 › A' });
    expect(texto(await definicion())).toBe(antes);
    expect(await seqDe()).toBe(0);
    expect((await ejecutarCambio(como('p-lucia'), { botId: BOT, seq: 0, operaciones: [], origen: 'editor' }) as { codigo: string }).codigo).toBe('operacion_invalida');
    expect((await ejecutarCambio(como('p-lucia'), { botId: 'bot-de-otra', seq: 0, operaciones: [renombrarMenu('x')], origen: 'editor' }) as { codigo: string }).codigo).toBe('no_existe');
  });

  it('varias operaciones son un solo cambio: se guardan y se deshacen juntas', async () => {
    const antes = texto(await definicion());
    const r = bien(await ejecutarCambio(como('p-lucia'), {
      botId: BOT, seq: 0, origen: 'copiloto',
      operaciones: [
        { tipo: 'agregar_caja', flujo: 'f_consultas', caja: { tipo: 'mensaje', contenido: 'c_masayuda', siguiente: null }, desde: { caja: 'n_masayuda', salida: { opcion: 'B' } } },
        renombrarMenu('Menú'),
      ],
    }));
    expect(r.resumen).toBe('2 cambios: Agregó la caja 2.8 (mensaje); Editó la caja 1.2');
    expect(r.creados).toHaveLength(1);
    expect(direccion(r.definicion, r.creados[0]!)).toBe('2.8');
    const d = bien(await ejecutarDeshacer(como('p-lucia'), { botId: BOT, seq: r.seq }));
    expect(texto(d.definicion)).toBe(antes);
    expect(d).toMatchObject({ resumen: 'Deshizo: 2 cambios: Agregó la caja 2.8 (mensaje); Editó la caja 1.2', deshacer: null, rehacer: r.resumen });
  });

  it('si otra persona guardó en el medio, el cambio se aplica sobre lo último y avisa', async () => {
    bien(await ejecutarCambio(como('p-joaquin'), { botId: BOT, seq: 0, operaciones: [renombrarMenu('De Joaquín')], origen: 'editor' }));
    const r = bien(await ejecutarCambio(como('p-lucia'), { botId: BOT, seq: 0, operaciones: [{ tipo: 'editar_caja', caja: 'n_bienvenida', cambios: { nombre: 'De Lucía' } }], origen: 'editor' }));
    expect(r).toMatchObject({ seq: 2, otroCambio: true });
    const d = await definicion();
    expect((ubicar(d, 'n_menu')!.caja as { nombre: string }).nombre).toBe('De Joaquín');
    expect((ubicar(d, 'n_bienvenida')!.caja as { nombre: string }).nombre).toBe('De Lucía');
  });

  it('el repositorio corta un guardado con un seq viejo', async () => {
    const b = (await repo.borrador(BOT))!;
    bien(await ejecutarCambio(como('p-lucia'), { botId: BOT, seq: 0, operaciones: [renombrarMenu('Uno')], origen: 'editor' }));
    await expect(repo.guardarCambio(b.id, 0, { origen: 'editor', operaciones: [], inversa: { tipo: 'restaurar', partes: { flujos: [], contenidos: [], intenciones: [], temas: [], variables: [], material: [], sueltos: {} } }, resumen: 'x', objetivo: null }, await definicion(), 'p-lucia'))
      .rejects.toMatchObject({ codigo: 'borrador_cambio' });
  });
});

describe('deshacer y rehacer', () => {
  it('ida y vuelta por el historial, y un cambio nuevo corta lo que se podía rehacer', async () => {
    const v0 = texto(await definicion());
    const a = bien(await ejecutarCambio(como('p-lucia'), { botId: BOT, seq: 0, operaciones: [renombrarMenu('A')], origen: 'editor' }));
    const v1 = texto(a.definicion);
    const b = bien(await ejecutarCambio(como('p-lucia'), { botId: BOT, seq: 1, operaciones: [{ tipo: 'quitar_intencion', intencion: 'prensa' }], origen: 'editor' }));
    expect(b.deshacer).toBe('Quitó la intención prensa');

    let r = bien(await ejecutarDeshacer(como('p-lucia'), { botId: BOT, seq: 2 }));
    expect(texto(r.definicion)).toBe(v1);
    expect(r).toMatchObject({ deshacer: 'Editó la caja 1.2', rehacer: 'Quitó la intención prensa' });
    r = bien(await ejecutarDeshacer(como('p-lucia'), { botId: BOT, seq: 3 }));
    expect(texto(r.definicion)).toBe(v0);
    expect(r).toMatchObject({ deshacer: null, rehacer: 'Editó la caja 1.2' });
    expect((await ejecutarDeshacer(como('p-lucia'), { botId: BOT, seq: 4 }) as { codigo: string }).codigo).toBe('nada_que_deshacer');

    r = bien(await ejecutarDeshacer(como('p-joaquin'), { botId: BOT, seq: 4, rehacer: true }));
    expect(texto(r.definicion)).toBe(v1);
    expect(r).toMatchObject({ resumen: 'Rehízo: Editó la caja 1.2', deshacer: 'Editó la caja 1.2', rehacer: 'Quitó la intención prensa' });

    r = bien(await ejecutarCambio(como('p-lucia'), { botId: BOT, seq: 5, operaciones: [renombrarMenu('C')], origen: 'editor' }));
    expect(r).toMatchObject({ deshacer: 'Editó la caja 1.2', rehacer: null });
    expect((await ejecutarDeshacer(como('p-lucia'), { botId: BOT, seq: 6, rehacer: true }) as { codigo: string }).codigo).toBe('nada_que_rehacer');
    r = bien(await ejecutarDeshacer(como('p-lucia'), { botId: BOT, seq: 6 }));
    expect(texto(r.definicion)).toBe(v1);

    const h = await repo.cambios(r.versionId);
    expect(h.map((x) => `${x.seq}:${x.origen}${x.objetivo ? `→${x.objetivo}` : ''}`)).toEqual(['1:editor', '2:editor', '3:deshacer→2', '4:deshacer→1', '5:rehacer→1', '6:editor', '7:deshacer→6']);
  });

  it('deshacer con un borrador que cambió no deshace otra cosa', async () => {
    bien(await ejecutarCambio(como('p-lucia'), { botId: BOT, seq: 0, operaciones: [renombrarMenu('A')], origen: 'editor' }));
    bien(await ejecutarCambio(como('p-joaquin'), { botId: BOT, seq: 1, operaciones: [renombrarMenu('B')], origen: 'editor' }));
    expect((await ejecutarDeshacer(como('p-lucia'), { botId: BOT, seq: 1 }) as { codigo: string }).codigo).toBe('borrador_cambio');
    expect((await ejecutarDeshacer(como('p-andres'), { botId: BOT, seq: 2 }) as { codigo: string }).codigo).toBe('sin_permiso');
  });

  it('un bot archivado no se cambia', async () => {
    await repo.archivarBot(BOT, 'p-joaquin');
    expect((await ejecutarCambio(como('p-lucia'), { botId: BOT, seq: 0, operaciones: [renombrarMenu('A')], origen: 'editor' }) as { codigo: string }).codigo).toBe('archivado');
    expect((await ejecutarDeshacer(como('p-lucia'), { botId: BOT, seq: 0 }) as { codigo: string }).codigo).toBe('archivado');
  });
});

describe('YAML sobre el borrador', () => {
  const exportar = async () => yamlDelBorrador({ nombre: 'Asistente' }, (await repo.borrador(BOT))!, await definicion(), new Date('2026-09-29T12:00:00Z'));

  it('exportar e importar sin tocar nada no cambia nada', async () => {
    const y = await exportar();
    expect(y).toContain('# Exportado del cambio 0 del borrador v1, el 2026-09-29 12:00 (UTC).');
    expect(await ejecutarImportarYaml(como('p-lucia'), { botId: BOT, texto: y })).toMatchObject({ ok: false, codigo: 'sin_cambios' });
  });

  it('importar guarda un cambio de origen yaml que se deshace', async () => {
    const antes = texto(await definicion());
    const y = (await exportar()).replace('nombre: Menú principal', 'nombre: Menú del YAML');
    const r = bien(await ejecutarImportarYaml(como('p-lucia'), { botId: BOT, texto: y }));
    expect(r.resumen).toBe('Importó el YAML: cambió 1 flujo');
    expect((ubicar(r.definicion, 'n_menu')!.caja as { nombre: string }).nombre).toBe('Menú del YAML');
    expect((await repo.cambios(r.versionId)).at(-1)).toMatchObject({ origen: 'yaml', resumen: 'Importó el YAML: cambió 1 flujo' });
    const d = bien(await ejecutarDeshacer(como('p-lucia'), { botId: BOT, seq: r.seq }));
    expect(texto(d.definicion)).toBe(antes);
  });

  it('si el borrador cambió desde que se exportó, avisa y solo sigue con "igual"', async () => {
    const y = (await exportar()).replace('nombre: Menú principal', 'nombre: Menú del YAML');
    bien(await ejecutarCambio(como('p-joaquin'), { botId: BOT, seq: 0, operaciones: [{ tipo: 'editar_caja', caja: 'n_bienvenida', cambios: { nombre: 'Hola' } }], origen: 'editor' }));
    expect(await ejecutarImportarYaml(como('p-lucia'), { botId: BOT, texto: y })).toMatchObject({ ok: false, codigo: 'yaml_desactualizado' });
    const r = bien(await ejecutarImportarYaml(como('p-lucia'), { botId: BOT, texto: y, igual: true }));
    expect((ubicar(r.definicion, 'n_bienvenida')!.caja as { nombre: string }).nombre).toBe('Bienvenida');
  });

  it('los errores vuelven con línea; el lector no importa', async () => {
    const y = (await exportar()).replace('modo: lista', 'modo: rueda');
    const r = await ejecutarImportarYaml(como('p-lucia'), { botId: BOT, texto: y });
    expect(r).toMatchObject({ ok: false, codigo: 'yaml' });
    expect(!r.ok && r.problemasYaml?.[0]?.linea).toBeGreaterThan(1);
    expect(await ejecutarImportarYaml(como('p-equipo'), { botId: BOT, texto: y })).toMatchObject({ ok: false, codigo: 'sin_permiso' });
  });
});

describe('formularios de las partes del borrador', () => {
  const enviar = (p: string, x: Record<string, string>) => ejecutarFormulario(como(p), fd({ botId: BOT, seq: '0', ...x }));

  it('contenidos: editar, agregar y quitar (solo si no se usa)', async () => {
    expect(await enviar('p-lucia', { forma: 'contenido_editar', contenido: 'c_menu', nombre: 'Menú', texto: '¿Qué necesita hoy?' })).toEqual({ tipo: 'ok', codigo: 'cambio_guardado' });
    expect((await definicion()).contenidos.find((c) => c.id === 'c_menu')).toMatchObject({ nombre: 'Menú', texto: '¿Qué necesita hoy?' });
    expect(await enviar('p-lucia', { forma: 'contenido_agregar', nombre: 'Afiche', tipo: 'imagen', texto: 'Nuestro afiche', archivoUrl: 'https://ejemplo.org/afiche.png' })).toMatchObject({ tipo: 'ok' });
    const afiche = (await definicion()).contenidos.find((c) => c.nombre === 'Afiche')!;
    expect(afiche.archivo).toEqual({ url: 'https://ejemplo.org/afiche.png', nombre: 'afiche.png' });
    expect(await enviar('p-lucia', { forma: 'contenido_quitar', contenido: 'c_menu' })).toEqual({ tipo: 'error', codigo: 'contenido_en_uso' });
    expect(await enviar('p-lucia', { forma: 'contenido_quitar', contenido: afiche.id })).toMatchObject({ tipo: 'ok' });
    expect(await enviar('p-equipo', { forma: 'contenido_quitar', contenido: afiche.id })).toEqual({ tipo: 'error', codigo: 'sin_permiso' });
  });

  it('intenciones y temas: el destino que cambia se nota en la definición', async () => {
    expect(await enviar('p-lucia', { forma: 'intencion_editar', intencion: 'agenda', nombre: 'Agenda', descripcion: 'Eventos y giras.', limite: '', frases: '¿Cuándo viene?\n\n¿Dónde es el acto?', destino: 'n_masayuda', tema: '' })).toMatchObject({ tipo: 'ok' });
    expect((await definicion()).intenciones.find((i) => i.id === 'agenda')).toMatchObject({ destino: 'n_masayuda', frases: ['¿Cuándo viene?', '¿Dónde es el acto?'], tema: null });
    expect(await enviar('p-lucia', { forma: 'intencion_agregar', nombre: 'Voto en el exterior', descripcion: 'Cómo votar desde afuera.', destino: 'n_irconsul' })).toMatchObject({ tipo: 'ok' });
    expect((await definicion()).intenciones.at(-1)).toMatchObject({ id: 'voto_en_el_exterior', destino: 'n_irconsul' });
    expect(await enviar('p-lucia', { forma: 'intencion_agregar', nombre: 'Voto en el exterior', descripcion: 'x' })).toEqual({ tipo: 'error', codigo: 'id_repetido' });
    expect(await enviar('p-lucia', { forma: 'tema_agregar', nombre: 'Deporte' })).toMatchObject({ tipo: 'ok' });
    expect(await enviar('p-lucia', { forma: 'tema_quitar', tema: 'deporte' })).toMatchObject({ tipo: 'ok' });
  });

  it('variables, identidad, contacto y sistema', async () => {
    expect(await enviar('p-lucia', { forma: 'identidad', candidato: 'Ana Ríos', candidatoAlias: 'Ana, la doctora', partido: '', partidoAlias: '' })).toMatchObject({ tipo: 'ok' });
    let d = await definicion();
    expect(d.identidad).toEqual({ candidato: { nombre: 'Ana Ríos', alias: ['Ana', 'la doctora'] }, partido: null });
    expect(d.variables.find((v) => v.nombre === 'bot.candidato')?.valor).toBe('Ana Ríos');
    expect(await enviar('p-lucia', { forma: 'contacto', consultasCanal: 'whatsapp', consultasValor: '+507 6000-0000', aportesCanal: '', aportesValor: '' })).toMatchObject({ tipo: 'ok' });
    expect(await enviar('p-lucia', { forma: 'variable_agregar', ambito: 'bot', nombre: 'Sitio web', valor: 'ejemplo.org' })).toMatchObject({ tipo: 'ok' });
    expect(await enviar('p-lucia', { forma: 'variable_editar', variable: 'bot.sitio_web', valor: 'otro.org', descripcion: 'El sitio' })).toMatchObject({ tipo: 'ok' });
    expect(await enviar('p-lucia', { forma: 'variable_quitar', variable: 'contacto.nombre' })).toEqual({ tipo: 'error', codigo: 'variable_en_uso' });
    expect(await enviar('p-lucia', { forma: 'sistema', noEntendi: 'c_noentendi', aclaracion: 'c_aclaracion', cierre: 'c_masayuda', sinMotor: 'c_sinmotor' })).toMatchObject({ tipo: 'ok' });
    d = await definicion();
    expect(d.contacto.consultas).toEqual({ canal: 'whatsapp', valor: '+507 6000-0000' });
    expect(d.variables.find((v) => v.nombre === 'bot.sitio_web')).toMatchObject({ valor: 'otro.org', descripcion: 'El sitio' });
    expect(d.sistema.cierre).toBe('c_masayuda');
    expect(await enviar('p-lucia', { forma: 'sistema', noEntendi: 'c_noentendi', aclaracion: 'c_aclaracion', cierre: 'c_masayuda', sinMotor: 'c_sinmotor' })).toEqual({ tipo: 'error', codigo: 'sin_cambios' });
  });

  it('deshacer desde el formulario', async () => {
    await enviar('p-lucia', { forma: 'tema_agregar', nombre: 'Deporte' });
    expect(await ejecutarDeshacerFormulario(como('p-lucia'), fd({ botId: BOT, seq: '1' }))).toEqual({ tipo: 'ok', codigo: 'deshecho' });
    expect((await definicion()).temas.some((t) => t.id === 'deporte')).toBe(false);
    expect(await ejecutarDeshacerFormulario(como('p-lucia'), fd({ botId: BOT, seq: '2', rehacer: 'si' }))).toEqual({ tipo: 'ok', codigo: 'rehecho' });
  });
});

describe('material desde el formulario', () => {
  const enviar = (x: Record<string, string>, extra?: (f: FormData) => void) => {
    const f = fd({ botId: BOT, seq: '0', ...x });
    extra?.(f);
    return ejecutarFormulario(como('p-lucia'), f);
  };

  it('pegar, subir un archivo, editar y quitar secciones', async () => {
    expect(await enviar({ forma: 'material_cargar', texto: '## Salud\nPropone más médicos.\nTemas: salud\nFuentes: Diario, 1/9/2026', reemplazar: 'si' })).toMatchObject({ tipo: 'ok' });
    let d = await definicion();
    expect(d.material).toEqual([{ codigo: 'S01', titulo: 'Salud', texto: 'Propone más médicos.', fuente: 'Diario, 1/9/2026', fecha: '', temas: ['salud'] }]);
    expect(await enviar({ forma: 'material_cargar', reemplazar: 'no' }, (f) => f.set('archivo', new File(['## Agua\nMás pozos.'], 'agua.md', { type: 'text/markdown' })))).toMatchObject({ tipo: 'ok' });
    d = await definicion();
    expect(d.material.map((s) => s.codigo)).toEqual(['S01', 'S02']);
    expect(await enviar({ forma: 'seccion_editar', seccion: 'S02', titulo: 'Agua potable', texto: 'Más pozos en Azuero.', fuente: '', fecha: '2026-09-01' }, (f) => f.append('temas', 'agua'))).toMatchObject({ tipo: 'ok' });
    expect((await definicion()).material[1]).toMatchObject({ titulo: 'Agua potable', temas: ['agua'], fecha: '2026-09-01' });
    expect(await enviar({ forma: 'seccion_quitar', seccion: 'S01' })).toMatchObject({ tipo: 'ok' });
    expect(await enviar({ forma: 'material_cargar', texto: 'sin títulos', reemplazar: 'no' })).toEqual({ tipo: 'error', codigo: 'material_vacio' });
  });
});
