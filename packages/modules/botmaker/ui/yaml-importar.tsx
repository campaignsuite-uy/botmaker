'use client';
/**
 * Editar el YAML del borrador e importarlo. Con useActionState el texto no se pierde si hay errores: vuelven con la
 * línea de cada uno y un clic lleva el cursor a esa línea.
 */
import { useActionState, useRef } from 'react';
import { Caja } from '@campaignsuite/ui';
import { importarYamlBorrador } from '../acciones/borrador';
import { textoError } from '../vistas/mensajes';

type Estado = Awaited<ReturnType<typeof importarYamlBorrador>> | null;

export function ImportarYaml(props: { campanaId: string; botId: string; inicial: string; hrefFlujos: string }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(importarYamlBorrador, null);
  const area = useRef<HTMLTextAreaElement>(null);
  const irALinea = (linea: number) => {
    const t = area.current;
    if (!t) return;
    const lineas = t.value.split('\n');
    const inicio = lineas.slice(0, linea - 1).reduce((a, l) => a + l.length + 1, 0);
    t.focus();
    t.setSelectionRange(inicio, inicio + (lineas[linea - 1]?.length ?? 0));
    t.scrollTop = Math.max(0, (linea - 5) * 18);
  };
  const texto = estado && !estado.ok ? estado.texto : props.inicial;
  return (
    <Caja titulo="Editar e importar">
      <form action={accion} className="pila">
        <input type="hidden" name="campanaId" value={props.campanaId} />
        <input type="hidden" name="botId" value={props.botId} />
        {estado?.ok ? (
          <div className="aviso aviso--ok" role="status">Listo: {estado.resumen}. Si algo no quedó bien, se deshace en <a href={props.hrefFlujos}>Flujos</a>.</div>
        ) : null}
        {estado && !estado.ok ? (
          <div className="aviso aviso--error" role="alert">
            {estado.mensaje ?? textoError(estado.codigo)}
            {estado.problemasYaml?.length ? (
              <ul className="bots-yaml-problemas">
                {estado.problemasYaml.map((p, i) => (
                  <li key={i}>
                    {p.linea ? <button type="button" className="ed-enlace" onClick={() => irALinea(p.linea!)}>Línea {p.linea}</button> : null}
                    {p.linea ? ': ' : ''}{p.mensaje}
                  </li>
                ))}
              </ul>
            ) : null}
            {estado.problemas?.length ? <ul className="bots-yaml-problemas">{estado.problemas.map((p, i) => <li key={i}>{p.donde}: {p.mensaje}</li>)}</ul> : null}
          </div>
        ) : null}
        <textarea
          ref={area} key={estado?.ok ? `ok-${estado.seq}` : 'yaml'} name="yaml" className="entrada bots-yaml" defaultValue={estado?.ok ? props.inicial : texto}
          spellCheck={false} rows={28} aria-label="YAML del bot"
        />
        {estado && !estado.ok && estado.codigo === 'yaml_desactualizado' ? (
          <label className="fila texto-chico"><input type="checkbox" name="igual" value="si" /> Importar igual (se pierde lo que se cambió en el medio)</label>
        ) : null}
        <div className="fila">
          <button type="submit" className="boton" disabled={enviando}>{enviando ? 'Importando…' : 'Importar'}</button>
          <span className="texto-mini apagado">Se compara con el borrador y se guarda como un solo cambio.</span>
        </div>
      </form>
    </Caja>
  );
}
