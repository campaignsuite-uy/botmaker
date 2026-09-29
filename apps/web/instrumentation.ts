import type { Instrumentation } from 'next';

/**
 * Errores del servidor a Sentry (8.03) con el cliente mínimo de BotMaker. Sin SENTRY_DSN no hace nada. Solo manda la
 * ruta de Next, el método y el error con su mensaje limpio: nada del pedido ni de la persona.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { reportarError } = await import('@campaignsuite/botmaker/observabilidad/sentry');
  await reportarError(err, { app: 'equipo', ruta: context.routePath, metodo: request.method, tipo: context.routeType });
};
