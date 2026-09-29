import { beforeEach, describe, expect, it } from 'vitest';
import { eventoDeError, leerDsn, limpiarTexto, marcosDePila, MAX_POR_MINUTO, reiniciarLimite, reportarError, sobreSentry } from './sentry';
import { manejarProbarSentry } from './http';

const DSN = 'https://abc123clavepublica@o4507.ingest.sentry.io/4508123';

beforeEach(() => reiniciarLimite());

describe('Sentry: el DSN', () => {
  it('lee la clave, el proyecto y arma el endpoint de sobres', () => {
    expect(leerDsn(DSN)).toEqual({ dsn: DSN, clave: 'abc123clavepublica', proyecto: '4508123', endpoint: 'https://o4507.ingest.sentry.io/api/4508123/envelope/' });
    expect(leerDsn('http://clave@localhost:9999/prefijo/7')?.endpoint).toBe('http://localhost:9999/prefijo/api/7/envelope/');
    for (const x of ['', undefined, 'no es una dirección', 'https://o1.ingest.sentry.io/123', 'https://clave@o1.ingest.sentry.io/', 'ftp://clave@host/1']) expect(leerDsn(x)).toBeNull();
  });
});

describe('Sentry: nada de la persona', () => {
  it('tapa correos, números, claves, parámetros y valores de la base', () => {
    const t = limpiarTexto('Falló con rosa.perez@ejemplo.org, +507 6123-4567 y Bearer eyJhbGciOi.xyz en https://x.org/b?token=secreto. Key (phone)=(50761234567) ya existe. sk-or-v1-abcdefghijklmnop');
    expect(t).not.toMatch(/rosa|6123|eyJ|secreto|50761234567|abcdefghij/);
    expect(t).toContain('[correo]');
    expect(t).toContain('https://x.org/b?[…]');
    expect(t).toContain('(phone)=([…])');
    expect(limpiarTexto('palabra '.repeat(100)).length).toBe(300);
  });

  it('la pila va del marco más viejo al más nuevo, sin la carpeta de la máquina', () => {
    const pila = 'Error: x\n    at leer (/srv/app/packages/modules/botmaker/datos/demo.ts:10:5)\n    at async Promise.all (index 0)\n    at /srv/app/node_modules/next/dist/server.js:1:2';
    expect(marcosDePila(pila, '/srv/app')).toEqual([
      { filename: 'node_modules/next/dist/server.js', lineno: 1, colno: 2, in_app: false },
      { function: 'leer', filename: 'packages/modules/botmaker/datos/demo.ts', lineno: 10, colno: 5, in_app: true },
    ]);
  });

  it('el evento lleva la ruta de Next sin valores, el método y el mensaje limpio', () => {
    const err = Object.assign(new TypeError('No existe el contacto de rosa@ejemplo.org'), { digest: '12345' });
    const e = eventoDeError(err, { app: 'equipo', ruta: '/[org]/[campana]/bots/contactos/[contacto]?buscar=Rosa', metodo: 'get', tipo: 'render' }, { id: 'a'.repeat(32), ahora: new Date('2026-10-01T12:00:00Z'), entorno: 'production' });
    expect(e).toMatchObject({ level: 'error', environment: 'production', transaction: '/[org]/[campana]/bots/contactos/[contacto]', tags: { app: 'equipo', metodo: 'GET', tipo: 'render', digest: '12345' } });
    expect(e.exception.values[0]).toMatchObject({ type: 'TypeError', value: 'No existe el contacto de [correo]' });
    const sobre = sobreSentry(e, leerDsn(DSN)!, new Date('2026-10-01T12:00:01Z')).split('\n');
    expect(sobre).toHaveLength(3);
    expect(JSON.parse(sobre[1]!)).toEqual({ type: 'event', content_type: 'application/json' });
    expect(sobre.join('\n')).not.toContain('Rosa');
  });
});

describe('Sentry: el envío', () => {
  const pedidos: { url: string; init: RequestInit }[] = [];
  const falso = (async (url: string, init: RequestInit) => {
    pedidos.push({ url, init });
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  beforeEach(() => { pedidos.length = 0; });

  it('sin SENTRY_DSN no manda nada', async () => {
    expect(await reportarError(new Error('x'), { app: 'publica' }, { entorno: {}, fetch: falso })).toBe(false);
    expect(pedidos).toHaveLength(0);
  });

  it('con DSN manda el sobre con la autenticación de Sentry; más de 30 por minuto, no', async () => {
    const ahora = new Date('2026-10-01T12:00:00Z');
    expect(await reportarError(new Error('boom'), { app: 'publica', ruta: '/api/conversar', metodo: 'POST' }, { entorno: { SENTRY_DSN: DSN }, fetch: falso, ahora: () => ahora })).toBe(true);
    expect(pedidos[0]!.url).toBe('https://o4507.ingest.sentry.io/api/4508123/envelope/');
    expect((pedidos[0]!.init.headers as Record<string, string>)['X-Sentry-Auth']).toContain('sentry_key=abc123clavepublica');
    for (let i = 1; i < MAX_POR_MINUTO + 5; i++) await reportarError(new Error('boom'), { app: 'publica' }, { entorno: { SENTRY_DSN: DSN }, fetch: falso, ahora: () => ahora });
    expect(pedidos).toHaveLength(MAX_POR_MINUTO);
    expect(await reportarError(new Error('boom'), { app: 'publica' }, { entorno: { SENTRY_DSN: DSN }, fetch: falso, ahora: () => new Date(ahora.getTime() + 61_000) })).toBe(true);
  });

  it('si Sentry no contesta, no tira', async () => {
    const roto = (async () => { throw new Error('sin red'); }) as unknown as typeof fetch;
    expect(await reportarError(new Error('x'), { app: 'equipo' }, { entorno: { SENTRY_DSN: DSN }, fetch: roto })).toBe(false);
  });
});

describe('Sentry: /api/probar-sentry', () => {
  it('pide la clave de las tareas; sin DSN avisa que está apagado; con DSN tira el error', async () => {
    const antes = { ...process.env };
    try {
      process.env.BOTS_TAREAS_SECRET = 'clave-de-prueba-de-tareas';
      delete process.env.SENTRY_DSN;
      expect((await manejarProbarSentry(new Request('http://x/api/probar-sentry'))).status).toBe(401);
      const conClave = () => new Request('http://x/api/probar-sentry', { headers: { authorization: 'Bearer clave-de-prueba-de-tareas' } });
      expect((await manejarProbarSentry(conClave())).status).toBe(409);
      process.env.SENTRY_DSN = DSN;
      await expect(manejarProbarSentry(conClave())).rejects.toThrow(/Prueba de Sentry/);
    } finally {
      process.env = antes;
    }
  });
});
