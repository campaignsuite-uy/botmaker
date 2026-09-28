import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaMotores } from '@campaignsuite/botmaker/ui/motores';
import { vistaMotores } from '@campaignsuite/botmaker/vistas/motores';
import { contextoBots, type Parametros } from '@/lib/modulo';

/** Motores: la ficha de cada uno y los de por defecto. */
export default async function Motores({ params }: { params: Parametros }) {
  const ctx = await contextoBots(params);
  return <PantallaMotores v={await vistaMotores(obtenerRepositorio(), ctx)} />;
}
