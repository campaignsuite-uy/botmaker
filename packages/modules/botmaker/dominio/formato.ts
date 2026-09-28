/**
 * Formatos de pantalla. Números con coma decimal (es-UY) y horas siempre en UTC, con la palabra "UTC" al lado.
 */
const nf = (min: number, max: number) => new Intl.NumberFormat('es-UY', { minimumFractionDigits: min, maximumFractionDigits: max });

/** "USD 0,0123" para montos chicos (costos de motores); "USD 12,50" desde 1 dólar. */
export function usd(x: number): string {
  if (!Number.isFinite(x)) return 'USD —';
  const abs = Math.abs(x);
  const f = abs === 0 ? nf(2, 2) : abs < 0.01 ? nf(4, 6) : abs < 1 ? nf(2, 4) : nf(2, 2);
  return `USD ${f.format(x)}`;
}

export function entero(x: number): string {
  return nf(0, 0).format(Math.round(x));
}

export function decimal(x: number, digitos = 2): string {
  return nf(digitos, digitos).format(x);
}

/** "28/9/2026 14:05 UTC". */
export function fechaHoraUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()} ${h}:${m} UTC`;
}

/** "28/9/2026" (del día en UTC). */
export function fechaUtc(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
}

/** El día en UTC ("2026-09-28") de una fecha. */
export function diaUtc(fecha: Date | string = new Date()): string {
  return (typeof fecha === 'string' ? new Date(fecha) : fecha).toISOString().slice(0, 10);
}

/** El primer día del mes en UTC ("2026-09-01"). */
export function inicioMesUtc(fecha: Date = new Date()): string {
  return `${fecha.toISOString().slice(0, 7)}-01`;
}

/** Suma días a un día UTC ("2026-09-28", -6 → "2026-09-22"). */
export function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function milisegundos(ms: number | null): string {
  if (ms == null) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${decimal(ms / 1000, 1)} s`;
}
