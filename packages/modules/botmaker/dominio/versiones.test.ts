import { describe, expect, it } from 'vitest';
import { pilasDeshacer, type CambioResumen, type OrigenCambio } from './versiones';

let seq = 0;
const c = (origen: OrigenCambio, resumen: string, objetivo: number | null = null): CambioResumen => ({ seq: ++seq, origen, resumen, objetivo, personaId: null, fecha: '' });

describe('pilas de deshacer y rehacer', () => {
  it('sin cambios no hay nada; con uno, se deshace ese', () => {
    expect(pilasDeshacer([])).toEqual({ deshacer: null, rehacer: null });
    seq = 0;
    expect(pilasDeshacer([c('editor', 'A')])).toEqual({ deshacer: { objetivo: 1, desde: 1, resumen: 'A' }, rehacer: null });
  });

  it('deshacer, deshacer, rehacer: cada paso sale del cambio correcto', () => {
    seq = 0;
    const h = [c('editor', 'A'), c('yaml', 'B')];
    h.push(c('deshacer', 'Deshizo: B', 2));
    expect(pilasDeshacer(h)).toEqual({ deshacer: { objetivo: 1, desde: 1, resumen: 'A' }, rehacer: { objetivo: 2, desde: 3, resumen: 'B' } });
    h.push(c('deshacer', 'Deshizo: A', 1));
    expect(pilasDeshacer(h)).toEqual({ deshacer: null, rehacer: { objetivo: 1, desde: 4, resumen: 'A' } });
    h.push(c('rehacer', 'Rehízo: A', 1));
    expect(pilasDeshacer(h)).toEqual({ deshacer: { objetivo: 1, desde: 5, resumen: 'A' }, rehacer: { objetivo: 2, desde: 3, resumen: 'B' } });
  });

  it('un cambio nuevo después de deshacer borra lo que se podía rehacer', () => {
    seq = 0;
    const h = [c('editor', 'A'), c('deshacer', 'Deshizo: A', 1), c('copiloto', 'C')];
    expect(pilasDeshacer(h)).toEqual({ deshacer: { objetivo: 3, desde: 3, resumen: 'C' }, rehacer: null });
  });

  it('el orden de llegada no importa: se ordena por seq', () => {
    seq = 0;
    const h = [c('editor', 'A'), c('editor', 'B'), c('deshacer', 'Deshizo: B', 2)];
    expect(pilasDeshacer([...h].reverse())).toEqual(pilasDeshacer(h));
  });

  it('un historial que no cierra no ofrece nada', () => {
    seq = 0;
    expect(pilasDeshacer([c('editor', 'A'), c('editor', 'B'), c('deshacer', 'x', 1)])).toEqual({ deshacer: null, rehacer: null });
    seq = 0;
    expect(pilasDeshacer([c('editor', 'A'), c('rehacer', 'x', 1)])).toEqual({ deshacer: null, rehacer: null });
  });
});
