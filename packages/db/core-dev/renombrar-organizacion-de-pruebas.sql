-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- renombrar-organizacion-de-pruebas.sql — SOLO DESARROLLO, una sola vez (30/9/2026).
--
-- Hasta el 30/9 la semilla creaba la organización «Movimiento Otro Camino» (otro-camino) y la campaña
-- «Generales 2029» (pa-2029), con los nombres del primer cliente. Ahora son una organización de pruebas de
-- CampaignSuite: «CampaignSuite · Pruebas» (pruebas) y «Panamá · Pruebas» (pa-pruebas). Esto renombra las que
-- ya existen en botmaker-dev sin perder nada: personas, roles, bots, conversaciones y costos cuelgan del
-- identificador, que no cambia. Si ya estaban renombradas, no hace nada.
--
-- Después: volver a correr 3-semilla-demo.sql (armado de nuevo con `pnpm db:sql --demo`) para que los bots de
-- ejemplo tomen el partido inventado. Borra y vuelve a cargar los mismos tres bots: no quedan repetidos.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

begin;

update core.organizations
   set slug = 'pruebas', name = 'CampaignSuite · Pruebas', kind = 'agencia'
 where slug = 'otro-camino';

update core.campaigns c
   set slug = 'pa-pruebas', name = 'Panamá · Pruebas'
  from core.organizations o
 where o.id = c.organization_id and o.slug = 'pruebas' and c.slug = 'pa-2029';

-- Comprobación: tiene que mostrar una fila, con los nombres nuevos.
select o.slug as organizacion, o.name as nombre, c.slug as campana, c.name as nombre_campana
  from core.organizations o join core.campaigns c on c.organization_id = o.id
 where o.slug = 'pruebas';

commit;
