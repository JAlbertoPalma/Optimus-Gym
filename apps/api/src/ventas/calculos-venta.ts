// CÁLCULOS DEL CU-04 (funciones puras: no tocan la BD ni la red).
// Las usa ventas.service.ts y se prueban directamente en test/calculos-venta.ts.
//
// Dinero: se trabaja en CENTAVOS enteros. Con decimales de JavaScript, 0.1 + 0.2 = 0.30000000000000004;
// con enteros no hay redondeos sorpresa. Solo al responder se convierte de vuelta a pesos.
// Fechas: siempre texto 'AAAA-MM-DD' y aritmética en UTC, así el huso horario del servidor
// no recorre un día. La fecha "hoy" la da PostgreSQL (CURRENT_DATE) para que coincida con la BD.

/** "600.00" (NUMERIC de PostgreSQL) o 600 → 60000 centavos. */
export const aCentavos = (v: string | number) => Math.round(Number(v) * 100);
/** 60000 → 600 (pesos con dos decimales como número). */
export const aPesos = (c: number) => c / 100;

/** Suma días a una fecha 'AAAA-MM-DD'. Respeta cambios de mes, año y años bisiestos. */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Edad cumplida en la fecha "hoy". */
export function edadEn(fechaNacimiento: string, hoy: string): number {
  const [an, mn, dn] = fechaNacimiento.slice(0, 10).split('-').map(Number);
  const [ah, mh, dh] = hoy.split('-').map(Number);
  return ah - an - (mh < mn || (mh === mn && dh < dn) ? 1 : 0);
}

export type TipoVigencia = 'NUEVA' | 'RENOVACION' | 'REACTIVACION';

/**
 * Política de vigencia (acordada para el CU-04): "extender sin perder días".
 *  - Con membresía vigente (último fin >= hoy) → RENOVACION: empieza el día siguiente a su vencimiento.
 *  - Con membresías pero todas vencidas → REACTIVACION: empieza hoy.
 *  - Sin membresías previas → NUEVA: empieza hoy.
 * Fin = inicio + duración − 1 (una Visita de 1 día empieza y termina el mismo día).
 * @param ultimoFin la fecha_fin más lejana de las membresías del cliente (null si nunca tuvo).
 */
export function calcularVigencia(hoy: string, ultimoFin: string | null, duracionDias: number) {
  const tipo: TipoVigencia = !ultimoFin ? 'NUEVA' : ultimoFin >= hoy ? 'RENOVACION' : 'REACTIVACION';
  const inicio = tipo === 'RENOVACION' ? sumarDias(ultimoFin!, 1) : hoy;
  return { tipo, inicio, fin: sumarDias(inicio, duracionDias - 1) };
}

export interface PromocionEvaluable {
  activa: boolean;
  fechaInicio: string | null;
  fechaFin: string | null;
  edadMinima: number | null;
  planes: number[]; // id_tipo a los que aplica
}

/**
 * ¿Se puede aplicar la promoción? Devuelve null si sí, o { codigo, mensaje } con el motivo.
 * @param fechaNacimiento null si todavía no se seleccionó cliente.
 */
export function evaluarPromocion(p: PromocionEvaluable, idTipo: number, hoy: string, fechaNacimiento: string | null) {
  if (!p.activa) return { codigo: 'PROMOCION_NO_DISPONIBLE', mensaje: 'La promoción no está disponible' };
  if (p.fechaInicio && hoy < p.fechaInicio) return { codigo: 'PROMOCION_NO_VIGENTE', mensaje: `La promoción inicia el ${p.fechaInicio}` };
  if (p.fechaFin && hoy > p.fechaFin) return { codigo: 'PROMOCION_VENCIDA', mensaje: `La promoción venció el ${p.fechaFin}` };
  if (!p.planes.includes(idTipo)) return { codigo: 'PROMOCION_NO_APLICA', mensaje: 'La promoción no aplica al plan seleccionado' };
  if (p.edadMinima) {
    if (!fechaNacimiento) return { codigo: 'CLIENTE_REQUERIDO', mensaje: 'Selecciona un cliente para validar la edad' };
    if (edadEn(fechaNacimiento, hoy) < p.edadMinima)
      return { codigo: 'REQUISITO_NO_CUMPLIDO', mensaje: `El cliente no cumple la edad mínima de ${p.edadMinima} años` };
  }
  return null;
}

/** Descuento en centavos. Nunca mayor que el precio, así el total nunca es negativo. */
export function calcularDescuento(precioCent: number, tipo: 'MONTO' | 'PORCENTAJE', valor: string | number): number {
  const d = tipo === 'MONTO' ? aCentavos(valor) : Math.round((precioCent * Number(valor)) / 100);
  return Math.min(Math.max(d, 0), precioCent);
}

/** Cambio en centavos para pago en efectivo, o null si el importe no alcanza. */
export function calcularCambio(totalCent: number, recibidoCent: number): number | null {
  return recibidoCent < totalCent ? null : recibidoCent - totalCent;
}
