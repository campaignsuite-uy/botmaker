import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { nucleoMemoria, reiniciarNucleoMemoria } from '@campaignsuite/platform/memoria';
import { RepositorioDemo } from '../datos/demo/repositorio-demo';
import { CANDIDATA_DEMO } from '../datos/demo/semilla';
import { direccion, ubicar, validarDefinicion, type Definicion } from '../dominio/definicion';
import { rolEfectivo } from './comun';
import { ejecutarCrearBot, type ContextoNucleo } from './ejecutar-bots';
import { ejecutarCambio, ejecutarCrearBorrador, ejecutarDeshacer, leerBorrador, type ResultadoBorrador } from './ejecutar-borrador';

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
    expect(r.resumen).toBe('2 cambios: Agregó la caja 2.7 (mensaje); Editó la caja 1.2');
    expect(r.creados).toHaveLength(1);
    expect(direccion(r.definicion, r.creados[0]!)).toBe('2.7');
    const d = bien(await ejecutarDeshacer(como('p-lucia'), { botId: BOT, seq: r.seq }));
    expect(texto(d.definicion)).toBe(antes);
    expect(d).toMatchObject({ resumen: 'Deshizo: 2 cambios: Agregó la caja 2.7 (mensaje); Editó la caja 1.2', deshacer: null, rehacer: r.resumen });
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
    await expect(repo.guardarCambio(b.id, 0, { origen: 'editor', operaciones: [], inversa: { tipo: 'restaurar', partes: { flujos: [], contenidos: [], intenciones: [], temas: [], variables: [], sueltos: {} } }, resumen: 'x', objetivo: null }, await definicion(), 'p-lucia'))
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
