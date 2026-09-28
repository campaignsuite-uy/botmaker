import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AVISO_SOLO_LECTURA, soloLectura } from '@campaignsuite/platform';
import '@campaignsuite/ui/estilos.css';
import '@campaignsuite/botmaker/ui/estilos.css';

export const metadata: Metadata = {
  title: 'BotMaker · CampaignSuite',
  description: 'Asistentes conversacionales de la campaña.',
  // La app es privada: ningún buscador la indexa (también lo dice el encabezado X-Robots-Tag, next.config.ts).
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;700;900&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
        {soloLectura() ? <FormulariosSinGuardar /> : null}
      </body>
    </html>
  );
}

/**
 * Demo online de solo lectura: los formularios se pueden completar, pero los que guardan no se envían; aparece un aviso.
 * Igual que en CampaignSuite (apps/web/app/layout.tsx): el proxy y las acciones también rechazan cualquier cambio.
 */
function FormulariosSinGuardar() {
  const js = `(function(){var T=${JSON.stringify(AVISO_SOLO_LECTURA)};var c=null,r=null;function avisar(){if(!c){c=document.createElement('div');c.className='aviso-flotante';c.setAttribute('role','status');c.setAttribute('aria-live','polite');document.body.appendChild(c);}c.textContent=T;c.hidden=false;clearTimeout(r);r=setTimeout(function(){c.hidden=true;},7000);}window.addEventListener('submit',function(e){var f=e.target;if(!f||f.tagName!=='FORM')return;if(f.getAttribute('data-solo-lectura')==='permitido')return;var s=e.submitter;var m=((s&&s.getAttribute('formmethod'))||f.getAttribute('method')||'get').toLowerCase();var a=(s&&s.getAttribute('formaction'))||f.getAttribute('action')||'';if(m==='get'&&a.indexOf('javascript:')!==0)return;e.preventDefault();e.stopImmediatePropagation();avisar();},true);})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
