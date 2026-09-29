import { PaginaNoDisponible } from '@campaignsuite/botmaker/ui/publico/pagina';

/** La raíz no muestra nada: cada bot tiene su dirección (/b/<id>). */
export default function Inicio() {
  return <PaginaNoDisponible />;
}
