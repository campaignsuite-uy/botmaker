import { PaginaPrueba } from '@campaignsuite/botmaker/ui/publico/pagina';

/** Un sitio de prueba con el widget pegado (?bot=<id público>). */
export default async function Prueba({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const bot = String((await searchParams).bot ?? 'p5v9c3h7pa').replace(/[^a-z0-9]/g, '').slice(0, 20);
  return <PaginaPrueba bot={bot} base="" />;
}
