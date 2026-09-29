'use client';
/**
 * El formulario de una plantilla nueva de WhatsApp: a medida que se escribe el texto aparecen los espacios que tiene
 * ({{1}} o {{nombre}}), un campo de ejemplo para cada uno (Meta los pide para revisarla), lo que hay que corregir y lo
 * que conviene revisar. La acción del servidor vuelve a validar todo.
 */
import { useState } from 'react';
import { crearPlantilla } from '../../acciones/whatsapp';
import { avisosPlantilla, problemasPlantilla, variablesDe, type CategoriaPlantilla } from '../../dominio/whatsapp';

interface Props {
  ocultos: React.ReactNode;
  categorias: { valor: string; texto: string }[];
  idiomas: { valor: string; texto: string }[];
}

export function NuevaPlantilla({ ocultos, categorias, idiomas }: Props) {
  const [nombre, setNombre] = useState('');
  const [categoria, setCategoria] = useState<CategoriaPlantilla>('utility');
  const [idioma, setIdioma] = useState('es');
  const [texto, setTexto] = useState('Hola {{1}}, te escribimos de la campaña por tu consulta sobre {{2}}. ¿Querés que sigamos conversando por acá?');
  const [ejemplos, setEjemplos] = useState<Record<string, string>>({ 1: 'Rosa', 2: 'transporte' });
  const { formato, variables } = variablesDe(texto);
  const problemas = problemasPlantilla({ nombre, categoria, idioma, texto, ejemplos });
  const avisos = avisosPlantilla({ texto, categoria });
  const empezado = nombre.length > 0;

  return (
    <form action={crearPlantilla} className="pila bots-form">
      {ocultos}
      <div className="bots-form__fila">
        <div className="campo">
          <label htmlFor="pl-nombre">Nombre (minúsculas, números y _)</label>
          <input id="pl-nombre" name="nombre" className="entrada" value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value.toLowerCase().replace(/\s+/g, '_'))} placeholder="retomar_consulta" required />
        </div>
        <div className="campo">
          <label htmlFor="pl-categoria">Categoría</label>
          <select id="pl-categoria" name="categoria" className="entrada" value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaPlantilla)}>
            {categorias.map((c) => <option key={c.valor} value={c.valor}>{c.texto}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="pl-idioma">Idioma</label>
          <select id="pl-idioma" name="idioma" className="entrada" value={idioma} onChange={(e) => setIdioma(e.target.value)}>
            {idiomas.map((i) => <option key={i.valor} value={i.valor}>{i.texto}</option>)}
          </select>
        </div>
      </div>
      <div className="campo">
        <label htmlFor="pl-texto">Texto: los espacios para completar van como {'{{1}}'}, {'{{2}}'}… o con nombre, como {'{{nombre}}'}</label>
        <textarea id="pl-texto" name="texto" className="entrada" rows={4} maxLength={1024} value={texto} onChange={(e) => setTexto(e.target.value)} required />
      </div>
      {variables.length ? (
        <fieldset className="bots-opciones">
          <legend className="campo__etiqueta">Un ejemplo para cada espacio ({formato === 'nombre' ? 'con nombre' : 'numerados'}): Meta los usa para revisarla</legend>
          {variables.map((v) => (
            <label key={v} className="campo">
              <span className="texto-chico">{`{{${v}}}`}</span>
              <input name={`ejemplo:${v}`} className="entrada" value={ejemplos[v] ?? ''} maxLength={200} onChange={(e) => setEjemplos({ ...ejemplos, [v]: e.target.value })} />
            </label>
          ))}
        </fieldset>
      ) : null}
      {empezado && problemas.length ? <ul className="bots-lista-avisos bots-lista-avisos--error">{problemas.map((p) => <li key={p}>{p}</li>)}</ul> : null}
      {avisos.length ? <ul className="bots-lista-avisos">{avisos.map((a) => <li key={a}>{a}</li>)}</ul> : null}
      <p className="texto-mini apagado">Meta revisa cada plantilla; puede tardar de minutos a un día. Para retomar una conversación, la categoría que corresponde es «Utilidad».</p>
      <div className="fila"><button type="submit" className="boton boton--chico" disabled={!!problemas.length}>Mandar a aprobar</button></div>
    </form>
  );
}
