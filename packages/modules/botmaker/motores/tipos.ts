/**
 * Lo que la capa de motores le pide a un adaptador (uno por ruta de acceso: OpenRouter, el simulado) y lo que recibe.
 * El adaptador no sabe de bots ni de topes: hace una llamada, con su tiempo máximo, y devuelve el texto crudo.
 */
import type { FichaMotor } from '../dominio/motores';
import type { FuncionMotor, UsoMotor } from '../dominio/tipos';

export interface PedidoAdaptador {
  ficha: FichaMotor;
  funcion: FuncionMotor;
  uso: UsoMotor;
  sistema: string;
  usuario: string;
  esquema: { nombre: string; schema: Record<string, unknown> };
  maxTokens: number;
  tiempoMaximoMs: number;
  /** La entrada estructurada: la usa el motor simulado para contestar sin modelo. */
  entrada: unknown;
}

export interface LlamadaCruda {
  ok: boolean;
  contenido: string | null;
  error: string | null;
  demoraMs: number;
  costoUsd: number | null;
  tokensEntrada: number | null;
  tokensSalida: number | null;
  tokensCache: number | null;
  tokensRazonamiento: number | null;
  proveedor: string | null;
  idGeneracion: string | null;
}

export interface Adaptador {
  readonly ruta: FichaMotor['ruta'];
  llamar(p: PedidoAdaptador): Promise<LlamadaCruda>;
}

export function llamadaFallida(error: string, demoraMs = 0): LlamadaCruda {
  return {
    ok: false, contenido: null, error, demoraMs, costoUsd: null, tokensEntrada: null, tokensSalida: null,
    tokensCache: null, tokensRazonamiento: null, proveedor: null, idGeneracion: null,
  };
}
