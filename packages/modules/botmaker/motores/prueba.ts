/**
 * Pedido chico para "Probar motor" (Ajustes del bot › Motores): confirma que el motor responde con la clave y el
 * proveedor configurados, y muestra su demora y su costo. No usa datos del bot: el material y el catálogo son de prueba.
 */
import type { FuncionMotor } from '../dominio/tipos';
import type { EntradaDe } from './contratos';

export const ENTRADA_PRUEBA: { [F in FuncionMotor]: EntradaDe[F] } = {
  interpretar: {
    mensaje: 'Buenas, ¿dónde me toca votar? Me mudé hace poco',
    turnos: [],
    intenciones: [
      { id: 'saludo', descripcion: 'Saluda sin pedir nada más' },
      { id: 'tramite_electoral', descripcion: 'Pregunta dónde o cómo votar, o por su inscripción en el padrón', ejemplos: ['dónde voto', 'cómo me cambio de centro de votación'] },
      { id: 'propuesta', descripcion: 'Pregunta qué propone el candidato sobre un tema' },
      { id: 'voluntariado', descripcion: 'Quiere sumarse a la campaña o ayudar' },
      { id: 'otra', descripcion: 'Ninguna de las anteriores' },
    ],
    temas: [
      { id: 'ninguno', nombre: 'Ninguno' },
      { id: 'empleo', nombre: 'Empleo' },
      { id: 'seguridad', nombre: 'Seguridad' },
    ],
  },
  responder: {
    pregunta: '¿Qué propone para el empleo?',
    turnos: [],
    material: [
      { codigo: 'S01', titulo: 'Propuesta de empleo (texto de prueba)', texto: 'La campaña propone un programa de primer empleo para jóvenes de 18 a 25 años, con prácticas pagas en empresas privadas.' },
      { codigo: 'S02', titulo: 'Contacto (texto de prueba)', texto: 'Para hablar con el equipo, se puede escribir al correo de la campaña que figura en su sitio.' },
    ],
  },
  copiloto: {
    pedido: 'Proponé un mensaje de bienvenida corto para el bot.',
    borrador: { flujos: [] },
  },
};
