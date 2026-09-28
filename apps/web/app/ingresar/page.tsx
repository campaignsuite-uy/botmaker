import { NUCLEO_DEMO, etiquetaDatos, modoDatos, tituloEtiquetaDatos } from '@campaignsuite/platform';
import { EtiquetaDatos } from '@campaignsuite/ui';
import { entrarComo, entrarConGoogle } from './acciones';

const ROL: Record<string, string> = {
  'p-joaquin': 'Dueño de la organización: administrador de BotMaker en cascada',
  'p-lucia': 'Editora: crea y cambia bots',
  'p-andres': 'Agente: atiende conversaciones derivadas',
  'p-equipo': 'Lector: ve bots y métricas',
  'p-mariana': 'Integrante de la campaña sin acceso a BotMaker',
};

const ERRORES: Record<string, string> = {
  sin_codigo: 'Google no devolvió el ingreso. Probá de nuevo.',
  sesion: 'No se pudo completar el ingreso. Probá de nuevo; si sigue, avisale al administrador.',
  google: 'Google no autorizó el ingreso. Probá de nuevo con tu cuenta de Google.',
};

/**
 * Ingreso. Con la base real (CAMPAIGNSUITE_DATOS=supabase): solo "Ingresar con Google", como en CampaignSuite. Con la
 * demo en memoria: el ingreso de prueba, para entrar con cada rol y ver qué cambia.
 */
export default async function Ingresar({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const error = typeof sp.error === 'string' ? (ERRORES[sp.error] ?? ERRORES.sesion!) : null;
  if (modoDatos() === 'supabase') {
    return (
      <div className="plataforma">
        <div className="plataforma__barra"><span className="plataforma__marca">CampaignSuite</span><span className="barra-sup__espacio" /></div>
        <div className="plataforma__contenido" style={{ maxWidth: 720 }}>
          <div className="encabezado__texto">
            <div className="ceja">BotMaker · Ingresar</div>
            <h1 className="titulo">Un solo ingreso <em>para toda la campaña</em></h1>
            <p className="bajada">Entrás con tu cuenta de Google. Tu organización decide a qué campañas y productos accedés y con qué rol.</p>
          </div>
          {error ? <div className="aviso aviso--error" role="alert">{error}</div> : null}
          <form action={entrarConGoogle}>
            <button type="submit" className="boton">Ingresar con Google</button>
          </form>
          <p className="texto-mini apagado">Si tu cuenta todavía no tiene acceso, pedíselo al administrador de tu organización.</p>
          <p className="texto-mini"><a href="/privacidad">Política de privacidad</a></p>
        </div>
      </div>
    );
  }
  const etiqueta = etiquetaDatos();
  return (
    <div className="plataforma">
      <div className="plataforma__barra"><span className="plataforma__marca">CampaignSuite</span><span className="barra-sup__espacio" />{etiqueta ? <EtiquetaDatos etiqueta={etiqueta} titulo={tituloEtiquetaDatos()} /> : null}</div>
      <div className="plataforma__contenido" style={{ maxWidth: 1100 }}>
        <div className="encabezado__texto">
          <div className="ceja">BotMaker · ingreso de prueba</div>
          <h1 className="titulo">Elegí <em>con quién entrar</em></h1>
          <p className="bajada">Es la demo en memoria: no hay cuentas ni base de datos. Cada persona tiene un rol distinto en BotMaker para ver qué cambia.</p>
        </div>
        <form action={entrarComo} className="grilla-3" data-solo-lectura="permitido">
          {NUCLEO_DEMO.personas.map((p) => (
            <button key={p.id} type="submit" name="persona" value={p.id} className="producto" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
              <span className="fila"><span className="avatar">{p.iniciales}</span><strong>{p.nombre}</strong></span>
              <span className="texto-chico secundario">{ROL[p.id] ?? ''}</span>
              <span className="enlace-mayus" style={{ marginTop: 'auto' }}>Entrar →</span>
            </button>
          ))}
        </form>
        <p className="texto-mini apagado">Con la base real se entra con Google (Supabase Auth). Sin contraseñas.</p>
      </div>
    </div>
  );
}
