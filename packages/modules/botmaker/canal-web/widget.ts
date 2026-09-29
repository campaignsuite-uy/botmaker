/**
 * El script del widget: el cliente lo pega una vez en su sitio con
 *   <script src="https://<app pública>/widget.js" data-bot="<id público>" async></script>
 * y agrega un botón abajo a la derecha que abre la conversación en un marco (la página del bot en modo incrustado).
 * No lee nada del sitio ni pone cookies: la conversación vive en el marco, que es de la app pública.
 */
export function scriptWidget(base: string): string {
  const b = JSON.stringify(base.replace(/\/$/, ''));
  return `(function(){
  var s=document.currentScript;if(!s)return;var bot=s.getAttribute('data-bot');if(!bot||!/^[a-z0-9]{6,20}$/.test(bot))return;
  var origen=new URL(s.src).origin+${b};var texto=s.getAttribute('data-texto')||'Conversar';
  if(document.getElementById('botmaker-widget'))return;
  var caja=document.createElement('div');caja.id='botmaker-widget';
  caja.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483000;font-family:system-ui,sans-serif';
  var boton=document.createElement('button');boton.type='button';boton.textContent=texto;boton.setAttribute('aria-expanded','false');
  boton.style.cssText='border:0;border-radius:24px;padding:12px 18px;background:#1f1f1f;color:#fff;font-size:15px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25)';
  var marco=null;
  boton.addEventListener('click',function(){
    if(!marco){marco=document.createElement('iframe');marco.src=origen+'/b/'+bot+'?incrustado=1';marco.title='Conversación';
      marco.style.cssText='display:block;border:1px solid #d0d0d0;border-radius:12px;background:#fff;width:min(380px,calc(100vw - 32px));height:min(600px,calc(100vh - 96px));margin-bottom:10px;box-shadow:0 8px 32px rgba(0,0,0,.25)';
      caja.insertBefore(marco,boton);boton.setAttribute('aria-expanded','true');boton.textContent='Cerrar';return;}
    var abierto=marco.style.display!=='none';marco.style.display=abierto?'none':'block';boton.setAttribute('aria-expanded',abierto?'false':'true');boton.textContent=abierto?texto:'Cerrar';
  });
  caja.appendChild(boton);document.body.appendChild(caja);
})();
`;
}
