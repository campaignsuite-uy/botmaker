/** La planilla de resultados: una hoja por tabla, con encabezados legibles y la primera fila fija. */
import ExcelJS from 'exceljs';

const NOMBRES: Record<string, string> = {
  combinacion: 'Combinación', mensajes: 'Mensajes', porReglas: 'Resueltos por reglas', sinRespuesta: 'Sin respuesta', acierto: 'Acierto (%)',
  coinciden: 'Coinciden (%)', aciertoCuandoCoinciden: 'Acierto cuando coinciden (%)', aclaracion: 'Aclaración (%)', aciertoTema: 'Acierto de tema (%)',
  demoraP50: 'Demora p50 (ms)', demoraP95: 'Demora p95 (ms)', costoUsd: 'Costo (USD)', costoPorMil: 'Costo por 1000 mensajes (USD)',
  preguntas: 'Preguntas', sinRespuestaDelMotor: 'Sin respuesta del motor', exactitudPromedio: 'Exactitud (0 a 2)', exactas: 'Exactas (%)',
  inventa: 'Inventa (%)', cortadasPorElValidador: 'Cortadas por el validador (%)', reconoceLoQueFalta: 'Reconoce lo que falta (%)', costoJuezUsd: 'Costo del juez (USD)',
};

export async function escribirPlanilla(archivo: string, hojas: { nombre: string; filas: object[] }[]): Promise<void> {
  const libro = new ExcelJS.Workbook();
  for (const h of hojas) {
    const hoja = libro.addWorksheet(h.nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
    const claves = [...new Set(h.filas.flatMap((f) => Object.keys(f)))];
    hoja.columns = claves.map((k) => ({ header: NOMBRES[k] ?? k, key: k, width: Math.min(60, Math.max(12, (NOMBRES[k] ?? k).length + 2)) }));
    for (const f of h.filas) hoja.addRow(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 'sí' : 'no') : v])));
    hoja.getRow(1).font = { bold: true };
  }
  await libro.xlsx.writeFile(archivo);
}
