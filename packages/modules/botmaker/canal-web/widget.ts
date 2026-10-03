/**
 * El script del widget: el cliente lo pega una vez en su sitio con
 *   <script src="https://<app pública>/widget.js" data-bot="<id público>" async></script>
 * y agrega abajo a la derecha una burbuja que abre la conversación en un marco (la página del bot en modo incrustado).
 * A los pocos segundos muestra un saludo con las iniciales del candidato (lo pide a /api/widget); data-saludo="no" lo
 * apaga, y si la persona lo cierra no vuelve a aparecer en esa pestaña. En el celular la conversación ocupa toda la
 * pantalla y se cierra con la cruz de su cabecera (el marco avisa con postMessage); en la computadora, también con
 * Escape.
 *
 * Todo vive en un shadow DOM: los estilos del sitio no lo tocan y los del widget no tocan el sitio. No lee nada del
 * sitio ni pone cookies; solo recuerda en la pestaña (sessionStorage) si se cerró el saludo. La conversación vive en
 * el marco, que es de la app pública.
 */

const CSS = `
:host{all:initial}
.bm{--bm-borde:max(20px,env(safe-area-inset-right));--bm-abajo:max(20px,env(safe-area-inset-bottom));--bm-sombra:0 16px 48px rgba(16,18,24,.22),0 2px 8px rgba(16,18,24,.12);
  font-family:'Inter Variable','Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased}
.bm *{box-sizing:border-box}
.bm-lanzador{position:fixed;right:var(--bm-borde);bottom:var(--bm-abajo);z-index:2147483001;width:60px;height:60px;padding:0;border:0;border-radius:50%;
  display:grid;place-items:center;background:linear-gradient(135deg,#15161b 0%,#33353f 100%);color:#fff;cursor:pointer;
  box-shadow:0 0 0 1px rgba(255,255,255,.06),var(--bm-sombra);opacity:0;transform:scale(.6);pointer-events:none;
  transition:transform .28s cubic-bezier(.2,.8,.2,1),opacity .2s ease}
.bm[data-listo] .bm-lanzador{opacity:1;transform:none;pointer-events:auto}
.bm[data-listo] .bm-lanzador:hover{transform:scale(1.06)}
.bm-lanzador:focus-visible,.bm-saludo button:focus-visible{outline:3px solid #8b98ff;outline-offset:3px}
.bm-icono{grid-area:1/1;transition:transform .28s cubic-bezier(.2,.8,.2,1),opacity .2s ease}
.bm-icono--cerrar{opacity:0;transform:rotate(-90deg) scale(.5)}
.bm[data-estado=abierto] .bm-icono--chat{opacity:0;transform:rotate(90deg) scale(.5)}
.bm[data-estado=abierto] .bm-icono--cerrar{opacity:1;transform:none}
.bm-panel{position:fixed;right:var(--bm-borde);bottom:calc(var(--bm-abajo) + 76px);z-index:2147483000;width:400px;height:min(680px,calc(100vh - 120px));
  border-radius:22px;overflow:hidden;background:#fff;box-shadow:var(--bm-sombra);opacity:0;visibility:hidden;transform:translateY(14px) scale(.98);transform-origin:100% 100%;
  transition:opacity .2s ease,transform .28s cubic-bezier(.2,.8,.2,1),visibility 0s linear .28s}
.bm[data-estado=abierto] .bm-panel{opacity:1;visibility:visible;transform:none;transition:opacity .2s ease,transform .28s cubic-bezier(.2,.8,.2,1),visibility 0s}
.bm-marco{display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:normal}
.bm-cargando{position:absolute;inset:0;display:grid;place-items:center}
.bm-cargando span{width:26px;height:26px;border-radius:50%;border:3px solid rgba(120,124,135,.25);border-top-color:#5b5f6b;animation:bm-gira .8s linear infinite}
.bm[data-cargado] .bm-cargando{display:none}
.bm-saludo{position:fixed;right:var(--bm-borde);bottom:calc(var(--bm-abajo) + 78px);z-index:2147483000;display:flex;align-items:flex-start;gap:2px;
  max-width:min(320px,calc(100vw - 40px));padding:6px;border-radius:18px;background:#fff;color:#16171b;box-shadow:var(--bm-sombra);
  opacity:0;transform:translateY(10px) scale(.98);transform-origin:100% 100%;transition:opacity .25s ease,transform .32s cubic-bezier(.2,.8,.2,1)}
.bm-saludo::after{content:'';position:absolute;right:23px;bottom:-6px;width:14px;height:14px;background:inherit;border-radius:0 0 4px 0;transform:rotate(45deg)}
.bm-saludo[hidden]{display:none}
.bm-saludo--visible{opacity:1;transform:none}
.bm-saludo__abrir{position:relative;z-index:1;display:flex;align-items:flex-start;gap:11px;padding:8px 6px 8px 8px;border:0;border-radius:14px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.bm-saludo__avatar{width:36px;height:36px;flex-shrink:0;display:grid;place-items:center;border-radius:50%;background:linear-gradient(135deg,#2b2d36,#4c505c);color:#fff;font-size:13px;font-weight:650;letter-spacing:.02em}
.bm-saludo__textos{display:flex;flex-direction:column;gap:2px;padding-top:1px}
.bm-saludo__titulo{font-size:12px;font-weight:550;color:#6b6f78}
.bm-saludo__texto{font-size:15px;font-weight:600;line-height:1.35;letter-spacing:-.005em}
.bm-saludo__cerrar{position:relative;z-index:1;width:26px;height:26px;flex-shrink:0;display:grid;place-items:center;padding:0;border:0;border-radius:50%;background:#f0f1f4;color:#62666f;cursor:pointer}
.bm-saludo__cerrar:hover{background:#e4e5ea}
@media (prefers-color-scheme:dark){
  .bm-panel{background:#131418}
  .bm-saludo{background:#1f2128;color:#eceef2}
  .bm-saludo__titulo{color:#a3a7b0}
  .bm-saludo__cerrar{background:#2c2f37;color:#a3a7b0}
  .bm-saludo__cerrar:hover{background:#363a44}
  .bm-saludo__avatar{background:linear-gradient(135deg,#3a3d47,#5b5f6c)}
}
@media (max-width:520px){
  .bm-panel{top:0;left:0;right:0;bottom:0;width:auto;height:auto;border-radius:0;transform:translateY(24px)}
  .bm[data-estado=abierto] .bm-lanzador{opacity:0;transform:scale(.6);pointer-events:none}
}
@media (prefers-reduced-motion:reduce){.bm-lanzador,.bm-panel,.bm-saludo,.bm-icono{transition:none}.bm-cargando span{animation:none}}
@keyframes bm-gira{to{transform:rotate(360deg)}}
`;

// El lanzador va primero: es el primer botón del widget.
const HTML = `<div class="bm" data-estado="cerrado">
<button type="button" class="bm-lanzador" aria-label="Abrir la conversación" aria-expanded="false">
<svg class="bm-icono bm-icono--chat" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 3.5c-4.97 0-9 3.47-9 7.75 0 2.3 1.17 4.37 3.03 5.79L5.5 20.5l4.03-2.05c.8.18 1.63.28 2.47.28 4.97 0 9-3.47 9-7.75S16.97 3.5 12 3.5Z" fill="currentColor"/><circle cx="8.3" cy="11.3" r="1.15" fill="#2b2d36"/><circle cx="12" cy="11.3" r="1.15" fill="#2b2d36"/><circle cx="15.7" cy="11.3" r="1.15" fill="#2b2d36"/></svg>
<svg class="bm-icono bm-icono--cerrar" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
</button>
<div class="bm-panel" role="dialog" aria-label="Conversación con el asistente"><div class="bm-cargando"><span></span></div></div>
<div class="bm-saludo" hidden>
<button type="button" class="bm-saludo__abrir"><span class="bm-saludo__avatar" aria-hidden="true"></span><span class="bm-saludo__textos"><span class="bm-saludo__titulo"></span><span class="bm-saludo__texto"></span></span></button>
<button type="button" class="bm-saludo__cerrar" aria-label="Cerrar el saludo"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>
</div>
</div>`;

export function scriptWidget(base: string): string {
  const b = JSON.stringify(base.replace(/\/$/, ''));
  return `(function(){
  var s=document.currentScript;if(!s)return;var bot=s.getAttribute('data-bot');if(!bot||!/^[a-z0-9]{6,20}$/.test(bot))return;
  if(document.getElementById('botmaker-widget'))return;
  var dominio=new URL(s.src).origin;var origen=dominio+${b};var conSaludo=s.getAttribute('data-saludo')!=='no';
  var host=document.createElement('div');host.id='botmaker-widget';
  var raiz=host.attachShadow?host.attachShadow({mode:'open'}):host;
  raiz.innerHTML='<style>'+${JSON.stringify(CSS)}+'</style>'+${JSON.stringify(HTML)};
  var q=function(c){return raiz.querySelector(c)};
  var caja=q('.bm'),lanzador=q('.bm-lanzador'),panel=q('.bm-panel'),saludo=q('.bm-saludo');
  var marco=null,abierto=false,listo=false,espera=null,clave='botmaker-saludo:'+bot;
  function cerrado(){try{return sessionStorage.getItem(clave)==='1'}catch(e){return false}}
  function sinSaludo(recordar){clearTimeout(espera);if(recordar){try{sessionStorage.setItem(clave,'1')}catch(e){}}
    if(saludo.hidden)return;saludo.classList.remove('bm-saludo--visible');setTimeout(function(){saludo.hidden=true},260)}
  function abrir(){
    if(!marco){marco=document.createElement('iframe');marco.className='bm-marco';marco.title='Conversación con el asistente';
      marco.src=origen+'/b/'+bot+'?incrustado=1';marco.addEventListener('load',function(){caja.setAttribute('data-cargado','')});panel.appendChild(marco);}
    abierto=true;caja.setAttribute('data-estado','abierto');lanzador.setAttribute('aria-expanded','true');lanzador.setAttribute('aria-label','Cerrar la conversación');
    sinSaludo(true);setTimeout(function(){try{marco.focus()}catch(e){}},80);
  }
  function cerrar(){
    if(!abierto)return;abierto=false;caja.setAttribute('data-estado','cerrado');lanzador.setAttribute('aria-expanded','false');
    lanzador.setAttribute('aria-label','Abrir la conversación');try{lanzador.focus()}catch(e){}
  }
  lanzador.addEventListener('click',function(){abierto?cerrar():abrir()});
  q('.bm-saludo__abrir').addEventListener('click',abrir);
  q('.bm-saludo__cerrar').addEventListener('click',function(){sinSaludo(true)});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')cerrar()});
  window.addEventListener('message',function(e){if(marco&&e.source===marco.contentWindow&&e.origin===dominio&&e.data&&e.data.botmaker==='cerrar')cerrar()});
  function mostrar(d){
    if(listo)return;listo=true;caja.setAttribute('data-listo','');
    if(!d||!d.ok)return;
    q('.bm-saludo__avatar').textContent=d.iniciales||'';q('.bm-saludo__titulo').textContent=d.titulo||'';
    lanzador.setAttribute('aria-label','Abrir la conversación con el '+(d.titulo||'asistente').charAt(0).toLowerCase()+(d.titulo||'asistente').slice(1));
    if(!d.saludo||!conSaludo||cerrado())return;
    q('.bm-saludo__texto').textContent=d.saludo;
    espera=setTimeout(function(){if(abierto)return;saludo.hidden=false;requestAnimationFrame(function(){requestAnimationFrame(function(){saludo.classList.add('bm-saludo--visible')})})},3500);
  }
  function iniciar(){
    document.body.appendChild(host);
    setTimeout(function(){mostrar(null)},4000);
    fetch(origen+'/api/widget?bot='+bot).then(function(r){if(r.status===404){listo=true;host.remove();return null}return r.ok?r.json():null})
      .then(function(d){mostrar(d)},function(){mostrar(null)});
  }
  if(document.body)iniciar();else document.addEventListener('DOMContentLoaded',iniciar);
})();
`;
}
