/**
 * Contenidos, Intenciones y temas, Variables y datos, y YAML: las partes del borrador que no son el diagrama. Solo
 * dibujan las vistas de vistas/partes.ts. Cada formulario es un cambio del borrador que se deshace desde la barra.
 */
import type { ReactNode } from 'react';
import { Caja } from '@campaignsuite/ui';
import { cambiarBorrador, deshacerBorrador } from '../acciones/borrador';
import type { BaseParte, VistaContenidos, VistaIntenciones, VistaMaterial, VistaVariables, VistaYaml } from '../vistas/partes';
import { EncabezadoBot } from './encabezado-bot';
import { MensajeAccion, Ocultos, SoloLectura } from './piezas';
import { ImportarYaml } from './yaml-importar';

function Forma(props: { b: BaseParte; forma: string; ancla?: string; extra?: Record<string, string>; children: ReactNode; className?: string }) {
  return (
    <form action={cambiarBorrador} className={props.className ?? 'pila bots-form'}>
      <Ocultos campanaId={props.b.campanaId} volver={`${props.b.volver}${props.ancla ? `#${props.ancla}` : ''}`} extra={{ botId: props.b.botId, seq: String(props.b.seq), forma: props.forma, ...props.extra }} />
      {props.children}
    </form>
  );
}

/** Deshacer y rehacer el último cambio del borrador (el mismo historial que el diagrama). */
function BarraBorrador({ b }: { b: BaseParte }) {
  if (!b.editable || (!b.deshacer && !b.rehacer)) return null;
  const boton = (rehacer: boolean, resumen: string | null) => (resumen ? (
    <form action={deshacerBorrador}>
      <Ocultos campanaId={b.campanaId} volver={b.volver} extra={{ botId: b.botId, seq: String(b.seq), ...(rehacer ? { rehacer: 'si' } : {}) }} />
      <button type="submit" className="boton boton--sec boton--chico" title={resumen}>{rehacer ? 'Rehacer' : 'Deshacer'}</button>
    </form>
  ) : null);
  return (
    <div className="bots-barra-borrador texto-chico">
      <span className="apagado">{b.deshacer ? <>Último cambio: {b.deshacer}</> : <>Se puede rehacer: {b.rehacer}</>}</span>
      {boton(false, b.deshacer)}
      {boton(true, b.rehacer)}
    </div>
  );
}

function Cabeza({ b, bajada }: { b: BaseParte; bajada: string }) {
  return (
    <>
      <EncabezadoBot e={b.encabezado} bajada={bajada} />
      <MensajeAccion m={b.mensaje} />
      <BarraBorrador b={b} />
      {b.sinBorrador ? <div className="aviso" role="status">Este bot todavía no tiene borrador. <a href={b.sinBorrador.hrefFlujos}>Armalo en Flujos</a>.</div> : null}
    </>
  );
}

function Selector(props: { nombre: string; valor: string; opciones: { valor: string; texto: string }[]; vacio?: string; deshabilitado?: boolean; id?: string }) {
  return (
    <select id={props.id} name={props.nombre} className="entrada" defaultValue={props.valor} disabled={props.deshabilitado}>
      {props.vacio !== undefined ? <option value="">{props.vacio}</option> : null}
      {props.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
    </select>
  );
}

/** Texto con el formato de WhatsApp: *negrita*, _cursiva_ y ~tachado~. */
function TextoWhatsapp({ t }: { t: string }) {
  const partes = t.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);
  return (
    <>
      {partes.map((p, i) => {
        if (/^\*[^*]+\*$/.test(p)) return <strong key={i}>{p.slice(1, -1)}</strong>;
        if (/^_[^_]+_$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
        if (/^~[^~]+~$/.test(p)) return <s key={i}>{p.slice(1, -1)}</s>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

// ── Contenidos ──────────────────────────────────────────────────────────────────────────────────

export function PantallaContenidos({ v }: { v: VistaContenidos }) {
  return (
    <>
      <Cabeza b={v} bajada="La biblioteca de lo que dice el bot. Un texto usado en varias cajas se edita una vez y cambia en todas." />
      {v.contenidos.map((c) => (
        <Caja key={c.id} id={c.id} titulo={c.nombre} nota={[c.usos.length ? `en ${c.usos.map((u) => u.direccion).join(', ')}` : '', c.sistema.length ? `sistema: ${c.sistema.join(', ')}` : '', !c.usos.length && !c.sistema.length ? 'sin uso' : ''].filter(Boolean).join(' · ')}>
          <div className="bots-contenido">
            <div className="pila">
              {v.editable ? (
                <Forma b={v} forma="contenido_editar" ancla={c.id} extra={{ contenido: c.id }}>
                  <div className="campo">
                    <label htmlFor={`n-${c.id}`}>Nombre</label>
                    <input id={`n-${c.id}`} name="nombre" className="entrada" defaultValue={c.nombre} maxLength={60} required />
                  </div>
                  <div className="campo">
                    <label htmlFor={`t-${c.id}`}>{c.tipo === 'texto' ? 'Texto' : 'Pie'}</label>
                    <textarea id={`t-${c.id}`} name="texto" className="entrada" defaultValue={c.texto} maxLength={v.limiteTexto} rows={4} />
                    <span className="texto-mini apagado">{c.largo} de {v.limiteTexto} caracteres. *negrita*, _cursiva_ y variables como {'{{bot.horario}}'}.</span>
                  </div>
                  {c.tipo !== 'texto' ? (
                    <div className="grilla-2">
                      <input type="hidden" name="tipo" value={c.tipo} />
                      <div className="campo">
                        <label htmlFor={`u-${c.id}`}>Dirección del archivo (https)</label>
                        <input id={`u-${c.id}`} name="archivoUrl" className="entrada" defaultValue={c.archivo?.url ?? ''} type="url" />
                      </div>
                      <div className="campo">
                        <label htmlFor={`a-${c.id}`}>Nombre del archivo</label>
                        <input id={`a-${c.id}`} name="archivoNombre" className="entrada" defaultValue={c.archivo?.nombre ?? ''} maxLength={120} />
                      </div>
                    </div>
                  ) : null}
                  <div className="fila"><button type="submit" className="boton boton--chico">Guardar</button></div>
                </Forma>
              ) : (
                <p className="texto-chico bots-texto-largo">{c.texto}</p>
              )}
              {c.usos.length ? <div className="texto-mini apagado">Se usa en {c.usos.map((u, i) => <span key={u.direccion}>{i ? ', ' : ''}<a href={u.href}>{u.direccion}</a></span>)}.</div> : null}
              {v.editable && c.quitable ? (
                <Forma b={v} forma="contenido_quitar" extra={{ contenido: c.id }} className="fila">
                  <button type="submit" className="boton boton--sec boton--chico">Quitar este contenido</button>
                </Forma>
              ) : null}
            </div>
            <div className="bots-previas">
              <div className="bots-previa bots-previa--web">
                <div className="mayus apagado">Web</div>
                <div className="bots-burbuja">{c.archivo ? <div className="texto-mini apagado">[{c.tipo}: {c.archivo.nombre}]</div> : null}{c.previa}</div>
                {c.opciones.map((o) => (
                  <div key={o.direccion} className="bots-previa-botones">{o.items.map((x, i) => <span key={i} className="bots-previa-boton">{x.texto}</span>)}</div>
                ))}
              </div>
              <div className="bots-previa bots-previa--wa">
                <div className="mayus apagado">WhatsApp</div>
                <div className="bots-burbuja bots-burbuja--wa">{c.archivo ? <div className="texto-mini">[{c.tipo}: {c.archivo.nombre}]</div> : null}<TextoWhatsapp t={c.previa} /></div>
                {c.opciones.map((o) => (
                  <div key={o.direccion} className="bots-previa-botones">
                    {o.modo === 'lista' ? <span className="bots-previa-boton">Ver opciones ({o.items.length})</span> : o.items.map((x, i) => (
                      <span key={i} className={`bots-previa-boton${x.largo > x.tope ? ' est-critico' : ''}`} title={`${x.largo}/${x.tope}`}>{x.texto}</span>
                    ))}
                  </div>
                ))}
                {c.opciones.some((o) => o.items.some((x) => x.largo > x.tope)) ? <p className="texto-mini est-critico">Algún botón pasa el límite de WhatsApp.</p> : null}
              </div>
            </div>
          </div>
        </Caja>
      ))}
      {v.editable ? (
        <Caja titulo="Agregar un contenido">
          <Forma b={v} forma="contenido_agregar">
            <div className="grilla-2">
              <div className="campo">
                <label htmlFor="cn-nombre">Nombre</label>
                <input id="cn-nombre" name="nombre" className="entrada" maxLength={60} required />
              </div>
              <div className="campo">
                <label htmlFor="cn-tipo">Tipo</label>
                <select id="cn-tipo" name="tipo" className="entrada" defaultValue="texto">
                  <option value="texto">Texto</option>
                  <option value="imagen">Imagen (con pie)</option>
                  <option value="documento">Documento (con pie)</option>
                </select>
              </div>
            </div>
            <div className="campo">
              <label htmlFor="cn-texto">Texto o pie</label>
              <textarea id="cn-texto" name="texto" className="entrada" maxLength={v.limiteTexto} rows={3} />
            </div>
            <div className="grilla-2">
              <div className="campo">
                <label htmlFor="cn-url">Dirección del archivo (si es imagen o documento)</label>
                <input id="cn-url" name="archivoUrl" className="entrada" type="url" placeholder="https://…" />
              </div>
              <div className="campo">
                <label htmlFor="cn-archivo">Nombre del archivo</label>
                <input id="cn-archivo" name="archivoNombre" className="entrada" maxLength={120} />
              </div>
            </div>
            <p className="texto-mini apagado">Por ahora el archivo va por dirección: subirlo desde acá queda para cuando esté el almacenamiento.</p>
            <div className="fila"><button type="submit" className="boton">Agregar contenido</button></div>
          </Forma>
        </Caja>
      ) : !v.sinBorrador ? <SoloLectura>Los contenidos los cambian el editor y el administrador.</SoloLectura> : null}
    </>
  );
}

// ── Intenciones y temas ─────────────────────────────────────────────────────────────────────────

export function PantallaIntenciones({ v }: { v: VistaIntenciones }) {
  return (
    <>
      <Cabeza b={v} bajada="Lo que el bot reconoce en un mensaje escrito y adónde lleva cada cosa. La descripción y las frases de ejemplo son lo que lee el motor para decidir." />
      <Caja titulo={`Intenciones (${v.intenciones.length})`} nota="el destino vale para todas las cajas de interpretar, salvo sus rutas propias">
        <div className="bots-filas">
          {v.intenciones.map((i) => (
            <details key={i.id} id={`i-${i.id}`} className="bots-fila-detalle">
              <summary>
                <strong>{i.nombre}</strong> <span className="texto-mini apagado">{i.id}</span>
                <span className="texto-chico secundario"> → {i.destinoTexto}{i.temaTexto ? ` · tema ${i.temaTexto}` : ''} · {i.cantidadFrases} {i.cantidadFrases === 1 ? 'frase' : 'frases'}</span>
                {!i.destino ? <span className="texto-mini est-critico"> sin destino</span> : null}
              </summary>
              {v.editable ? (
                <Forma b={v} forma="intencion_editar" ancla={`i-${i.id}`} extra={{ intencion: i.id }}>
                  <div className="grilla-2">
                    <div className="campo"><label htmlFor={`in-${i.id}`}>Nombre</label><input id={`in-${i.id}`} name="nombre" className="entrada" defaultValue={i.nombre} maxLength={60} required /></div>
                    <div className="campo"><label htmlFor={`id-${i.id}`}>Destino</label><Selector id={`id-${i.id}`} nombre="destino" valor={i.destino} opciones={v.destinos} vacio="Sin destino (error)" /></div>
                  </div>
                  <div className="campo"><label htmlFor={`ide-${i.id}`}>Descripción: qué es</label><textarea id={`ide-${i.id}`} name="descripcion" className="entrada" defaultValue={i.descripcion} maxLength={300} rows={2} required /></div>
                  <div className="campo"><label htmlFor={`il-${i.id}`}>Límite: qué no es (opcional)</label><input id={`il-${i.id}`} name="limite" className="entrada" defaultValue={i.limite} maxLength={300} /></div>
                  <div className="grilla-2">
                    <div className="campo"><label htmlFor={`if-${i.id}`}>Frases de ejemplo, una por renglón</label><textarea id={`if-${i.id}`} name="frases" className="entrada" defaultValue={i.frases} rows={4} /></div>
                    <div className="campo"><label htmlFor={`it-${i.id}`}>Tema</label><Selector id={`it-${i.id}`} nombre="tema" valor={i.tema} opciones={v.opcionesTema} vacio="Sin tema" /></div>
                  </div>
                  {i.rutasPropias.length ? <p className="texto-mini apagado">Con ruta propia en {i.rutasPropias.join(', ')}: ahí va a otro lado.</p> : null}
                  <div className="fila">
                    <button type="submit" className="boton boton--chico">Guardar</button>
                    {i.hrefDestino ? <a className="texto-mini" href={i.hrefDestino}>Ver el destino en el diagrama</a> : null}
                  </div>
                </Forma>
              ) : (
                <div className="pila texto-chico">
                  <p>{i.descripcion}</p>
                  {i.limite ? <p className="apagado">No es: {i.limite}</p> : null}
                  {i.frases ? <p className="apagado">Frases: {i.frases.split('\n').join(' · ')}</p> : null}
                </div>
              )}
              {v.editable ? (
                <Forma b={v} forma="intencion_quitar" extra={{ intencion: i.id }} className="fila">
                  <button type="submit" className="boton boton--sec boton--chico">Quitar la intención</button>
                </Forma>
              ) : null}
            </details>
          ))}
        </div>
        {v.editable ? (
          <details className="bots-fila-detalle">
            <summary><strong>Agregar una intención</strong></summary>
            <Forma b={v} forma="intencion_agregar">
              <div className="grilla-2">
                <div className="campo"><label htmlFor="ni-nombre">Nombre</label><input id="ni-nombre" name="nombre" className="entrada" maxLength={60} required /></div>
                <div className="campo"><label htmlFor="ni-destino">Destino</label><Selector id="ni-destino" nombre="destino" valor="" opciones={v.destinos} vacio="Elegí una caja" /></div>
              </div>
              <div className="campo"><label htmlFor="ni-desc">Descripción: qué es</label><textarea id="ni-desc" name="descripcion" className="entrada" maxLength={300} rows={2} required /></div>
              <div className="campo"><label htmlFor="ni-frases">Frases de ejemplo, una por renglón</label><textarea id="ni-frases" name="frases" className="entrada" rows={3} /></div>
              <div className="fila"><button type="submit" className="boton boton--chico">Agregar intención</button></div>
            </Forma>
          </details>
        ) : null}
      </Caja>

      <Caja titulo={`Temas (${v.temas.length})`} nota="organizan el material y lo que pregunta la gente">
        <div className="bots-filas">
          {v.temas.map((t) => (
            <details key={t.id} id={`t-${t.id}`} className="bots-fila-detalle">
              <summary><strong>{t.nombre}</strong> <span className="texto-mini apagado">{t.id} · {t.usos ? `usado ${t.usos} ${t.usos === 1 ? 'vez' : 'veces'}` : 'sin uso'}</span></summary>
              {v.editable ? (
                <>
                  <Forma b={v} forma="tema_editar" ancla={`t-${t.id}`} extra={{ tema: t.id }} className="fila bots-fila-form">
                    <input name="nombre" className="entrada" aria-label="Nombre del tema" defaultValue={t.nombre} maxLength={60} required />
                    <input name="descripcion" className="entrada" aria-label="Descripción del tema" defaultValue={t.descripcion} maxLength={200} />
                    <button type="submit" className="boton boton--chico">Guardar</button>
                  </Forma>
                  <Forma b={v} forma="tema_quitar" extra={{ tema: t.id }} className="fila">
                    <button type="submit" className="boton boton--sec boton--chico">Quitar el tema</button>
                  </Forma>
                </>
              ) : <p className="texto-chico apagado">{t.descripcion}</p>}
            </details>
          ))}
        </div>
        {v.editable ? (
          <Forma b={v} forma="tema_agregar" className="fila bots-fila-form">
            <input name="nombre" className="entrada" aria-label="Nombre del tema nuevo" placeholder="Tema nuevo" maxLength={60} required />
            <input name="descripcion" className="entrada" aria-label="Descripción del tema nuevo" placeholder="Descripción (opcional)" maxLength={200} />
            <button type="submit" className="boton boton--chico">Agregar tema</button>
          </Forma>
        ) : null}
      </Caja>
    </>
  );
}

// ── Variables y datos ───────────────────────────────────────────────────────────────────────────

export function PantallaVariables({ v }: { v: VistaVariables }) {
  const ro = !v.editable;
  return (
    <>
      <Cabeza b={v} bajada="Quién es el candidato y cómo le dice la gente, dónde se consulta lo que el bot no sabe, las variables de los textos y los mensajes que el bot manda por su cuenta." />
      <Caja id="identidad" titulo="Candidato y partido" nota="los alias los lee el motor al interpretar">
        <Forma b={v} forma="identidad" ancla="identidad">
          <div className="grilla-2">
            <div className="campo"><label htmlFor="v-cand">Candidato o dirigente</label><input id="v-cand" name="candidato" className="entrada" defaultValue={v.identidad.candidato} maxLength={80} required disabled={ro} /></div>
            <div className="campo"><label htmlFor="v-calias">Cómo le dicen (separado por comas)</label><input id="v-calias" name="candidatoAlias" className="entrada" defaultValue={v.identidad.candidatoAlias} disabled={ro} /></div>
            <div className="campo"><label htmlFor="v-part">Partido (opcional)</label><input id="v-part" name="partido" className="entrada" defaultValue={v.identidad.partido} maxLength={80} disabled={ro} /></div>
            <div className="campo"><label htmlFor="v-palias">Siglas y alias del partido</label><input id="v-palias" name="partidoAlias" className="entrada" defaultValue={v.identidad.partidoAlias} disabled={ro} /></div>
          </div>
          {!ro ? <div className="fila"><button type="submit" className="boton boton--chico">Guardar</button></div> : null}
        </Forma>
      </Caja>

      <Caja id="contacto" titulo="Canales de contacto" nota="el de consultas lo ofrece el bot cuando no tiene un dato">
        <Forma b={v} forma="contacto" ancla="contacto">
          <div className="grilla-2">
            <div className="campo"><label htmlFor="v-cc">Consultas: canal</label><Selector id="v-cc" nombre="consultasCanal" valor={v.contacto.consultasCanal} opciones={v.canales} vacio="Sin canal" deshabilitado={ro} /></div>
            <div className="campo"><label htmlFor="v-cv">Consultas: número, correo o dirección</label><input id="v-cv" name="consultasValor" className="entrada" defaultValue={v.contacto.consultasValor} maxLength={200} disabled={ro} /></div>
            <div className="campo"><label htmlFor="v-ac">Aportes: canal</label><Selector id="v-ac" nombre="aportesCanal" valor={v.contacto.aportesCanal} opciones={v.canales} vacio="Sin canal" deshabilitado={ro} /></div>
            <div className="campo"><label htmlFor="v-av">Aportes: número, correo o dirección</label><input id="v-av" name="aportesValor" className="entrada" defaultValue={v.contacto.aportesValor} maxLength={200} disabled={ro} /></div>
          </div>
          {!ro ? <div className="fila"><button type="submit" className="boton boton--chico">Guardar</button></div> : null}
        </Forma>
      </Caja>

      <Caja id="variables" titulo="Variables" nota="las del bot tienen un valor fijo; las del contacto se llenan en cada conversación">
        <div className="bots-filas">
          {v.variables.map((x) => (
            <div key={x.nombre} className="bots-variable">
              <div><code>{`{{${x.nombre}}}`}</code> <span className="texto-mini apagado">{x.usos.length ? `en ${x.usos.join(', ')}` : 'sin uso'}</span></div>
              {v.editable ? (
                <div className="fila">
                  <Forma b={v} forma="variable_editar" ancla="variables" extra={{ variable: x.nombre }} className="fila bots-fila-form">
                    {x.ambito === 'bot' ? <input name="valor" className="entrada" aria-label={`Valor de ${x.nombre}`} defaultValue={x.valor} maxLength={500} placeholder="Valor" /> : null}
                    <input name="descripcion" className="entrada" aria-label={`Descripción de ${x.nombre}`} defaultValue={x.descripcion} maxLength={200} placeholder="Descripción" />
                    <button type="submit" className="boton boton--chico">Guardar</button>
                  </Forma>
                  {x.quitable ? (
                    <Forma b={v} forma="variable_quitar" extra={{ variable: x.nombre }} className="fila">
                      <button type="submit" className="boton boton--sec boton--chico">Quitar</button>
                    </Forma>
                  ) : null}
                </div>
              ) : <div className="texto-chico secundario">{x.ambito === 'bot' ? (x.valor || 'sin valor') : x.descripcion}</div>}
            </div>
          ))}
        </div>
        {v.editable ? (
          <Forma b={v} forma="variable_agregar" ancla="variables" className="fila bots-fila-form">
            <select name="ambito" className="entrada" aria-label="De qué es la variable" defaultValue="bot">
              <option value="bot">bot.</option>
              <option value="contacto">contacto.</option>
            </select>
            <input name="nombre" className="entrada" aria-label="Nombre de la variable nueva" placeholder="nombre (por ejemplo: sitio)" maxLength={30} required />
            <input name="valor" className="entrada" aria-label="Valor (solo las del bot)" placeholder="Valor (solo las del bot)" maxLength={500} />
            <button type="submit" className="boton boton--chico">Agregar variable</button>
          </Forma>
        ) : null}
      </Caja>

      <Caja id="sistema" titulo="Mensajes del sistema" nota="los manda el bot por su cuenta; el texto se edita en Contenidos">
        <Forma b={v} forma="sistema" ancla="sistema">
          <div className="grilla-2">
            {v.sistema.map((s) => (
              <div key={s.clave} className="campo">
                <label htmlFor={`s-${s.clave}`}>{s.etiqueta}</label>
                <Selector id={`s-${s.clave}`} nombre={s.clave} valor={s.valor} opciones={v.contenidos} deshabilitado={ro} />
              </div>
            ))}
          </div>
          {!ro ? <div className="fila"><button type="submit" className="boton boton--chico">Guardar</button></div> : null}
        </Forma>
      </Caja>
    </>
  );
}

// ── YAML ────────────────────────────────────────────────────────────────────────────────────────

export function PantallaYaml({ v }: { v: VistaYaml }) {
  return (
    <>
      <Cabeza b={v} bajada="El bot escrito como texto: para revisarlo de corrido, compararlo o cambiar muchas cosas de golpe. Importar guarda un solo cambio, que se deshace como cualquier otro." />
      {v.yaml ? (
        <Caja titulo="Exportar" accion={{ texto: 'Descargar .yaml', href: v.hrefDescargar }}>
          <p className="texto-chico secundario">Cada caja lleva su dirección en un comentario. Para agregar una caja o una opción, se puede dejar sin id, sin código o sin letra: se completan al importar.</p>
          {!v.editable ? <pre className="bots-yaml">{v.yaml}</pre> : null}
        </Caja>
      ) : null}
      {v.editable && v.yaml ? (
        <ImportarYaml campanaId={v.campanaId} botId={v.botId} inicial={v.yaml} hrefFlujos={v.volver.replace(/\/yaml$/, '/flujos')} />
      ) : v.yaml ? <SoloLectura>Importar un YAML es del editor y el administrador.</SoloLectura> : null}
    </>
  );
}

// ── Material ────────────────────────────────────────────────────────────────────────────────────

export function PantallaMaterial({ v }: { v: VistaMaterial }) {
  return (
    <>
      <Cabeza b={v} bajada="Lo que el bot puede usar para contestar preguntas abiertas, en secciones con su fuente. Contesta solo con esto, cita las secciones que usa y corta cualquier dato que no esté acá." />
      <Caja titulo={`${v.secciones.length} ${v.secciones.length === 1 ? 'sección' : 'secciones'} · unos ${v.tokens.toLocaleString('es')} tokens`} accion={v.secciones.length ? { texto: 'Descargar el material', href: v.hrefDescargar } : undefined}>
        {v.costo ? (
          <p className="texto-chico secundario">
            Cada respuesta con base le manda el material a {v.costo.motor}: unos {v.costo.sinCache} por respuesta{v.costo.conCache ? `, o ${v.costo.conCache} cuando el proveedor ya lo tiene en caché` : ''}. Una caja de respuesta que elige temas manda solo esas secciones y las generales.
          </p>
        ) : <p className="texto-chico secundario">Todavía no hay material: las respuestas con base dicen que no tienen el dato y ofrecen el canal de consultas.</p>}
        {v.editable ? (
          <Forma b={v} forma="material_cargar">
            <div className="campo">
              <label htmlFor="m-texto">Pegar el material</label>
              <textarea id="m-texto" name="texto" className="entrada bots-yaml" rows={8} placeholder={'## Quién es el candidato\nTexto de la sección…\nFuentes: medio, fecha.\n\n## Salud\nTexto…\nTemas: salud'} />
              <span className="texto-mini apagado">Una sección por título de segundo nivel (## Título). Opcionales al final de cada una: Temas:, Fecha: y Fuentes:.</span>
            </div>
            <div className="campo">
              <label htmlFor="m-archivo">O subir un archivo de texto (.md o .txt, hasta 2 MB)</label>
              <input id="m-archivo" name="archivo" type="file" accept=".md,.txt,text/plain,text/markdown" className="entrada" />
            </div>
            <fieldset className="bots-opciones">
              <legend className="campo__etiqueta">Qué hacer con lo que ya hay</legend>
              <label className="bots-opcion"><input type="radio" name="reemplazar" value="no" defaultChecked /> <span>Agregar estas secciones a las que ya están</span></label>
              <label className="bots-opcion"><input type="radio" name="reemplazar" value="si" /> <span>Reemplazar todo el material</span></label>
            </fieldset>
            <div className="fila"><button type="submit" className="boton">Cargar</button><a className="texto-chico" href={v.hrefSimulador}>Probarlo en el simulador</a></div>
          </Forma>
        ) : null}
      </Caja>
      {v.secciones.length ? (
        <Caja titulo="Secciones" nota="cada versión guarda su copia: lo publicado no cambia">
          <div className="bots-filas">
            {v.secciones.map((s) => (
              <details key={s.codigo} id={s.codigo} className="bots-fila-detalle">
                <summary>
                  <strong>{s.codigo} · {s.titulo}</strong>
                  <span className="texto-mini apagado"> · {s.tokens} tokens{s.temasTexto ? ` · ${s.temasTexto}` : ' · general'}{s.fecha ? ` · ${s.fecha}` : ''}</span>
                </summary>
                {v.editable ? (
                  <Forma b={v} forma="seccion_editar" ancla={s.codigo} extra={{ seccion: s.codigo }}>
                    <div className="campo"><label htmlFor={`st-${s.codigo}`}>Título</label><input id={`st-${s.codigo}`} name="titulo" className="entrada" defaultValue={s.titulo} maxLength={120} required /></div>
                    <div className="campo"><label htmlFor={`sx-${s.codigo}`}>Texto</label><textarea id={`sx-${s.codigo}`} name="texto" className="entrada" defaultValue={s.texto} rows={8} required /></div>
                    <div className="grilla-2">
                      <div className="campo"><label htmlFor={`sf-${s.codigo}`}>Fuentes</label><input id={`sf-${s.codigo}`} name="fuente" className="entrada" defaultValue={s.fuente} maxLength={600} /></div>
                      <div className="campo"><label htmlFor={`sd-${s.codigo}`}>Fecha del dato</label><input id={`sd-${s.codigo}`} name="fecha" className="entrada" defaultValue={s.fecha} maxLength={40} placeholder="AAAA-MM-DD" /></div>
                    </div>
                    <fieldset className="ed-temas">
                      <legend className="campo__etiqueta">Temas (sin temas: entra en toda respuesta con base)</legend>
                      <div className="ed-chips">
                        {v.temas.map((t) => <label key={t.valor} className="chip ed-chip"><input type="checkbox" name="temas" value={t.valor} defaultChecked={s.temas.includes(t.valor)} /> {t.texto}</label>)}
                      </div>
                    </fieldset>
                    <p className="texto-mini apagado">La usan {s.citadaEn.length ? s.citadaEn.join(', ') : 'ninguna caja de respuesta con base todavía'}.</p>
                    <div className="fila"><button type="submit" className="boton boton--chico">Guardar</button></div>
                  </Forma>
                ) : (
                  <div className="pila texto-chico">
                    <p className="bots-texto-largo">{s.texto}</p>
                    {s.fuente ? <p className="apagado">Fuentes: {s.fuente}</p> : null}
                  </div>
                )}
                {v.editable ? (
                  <Forma b={v} forma="seccion_quitar" extra={{ seccion: s.codigo }} className="fila">
                    <button type="submit" className="boton boton--sec boton--chico">Quitar la sección</button>
                  </Forma>
                ) : null}
              </details>
            ))}
          </div>
        </Caja>
      ) : null}
    </>
  );
}
