// CÁLCULOS DEL CU-04 (funciones puras: no tocan la BD ni la red).
// Las usa ventas.service.ts y se prueban directamente en test/calculos-venta.ts.
//
// Dinero: se trabaja en CENTAVOS enteros. Con decimales de JavaScript, 0.1 + 0.2 = 0.30000000000000004;
// con enteros no hay redondeos sorpresa. Solo al responder se convierte de vuelta a pesos.
// Fechas: siempre texto 'AAAA-MM-DD' y aritmética en UTC, así el huso horario del servidor
// no recorre un día. La fecha "hoy" la da PostgreSQL (CURRENT_DATE) para que coincida con la BD.

/** "600.00" (NUMERIC de PostgreSQL) o 600 → 60000 centavos. */
export const aCentavos = (v: string | number) => Math.floor(Number(v) * 100);
/** 60000 → 600 (pesos con dos decimales como número). */
export const aPesos = (c: number) => c / 100;

/** Suma días a una fecha 'AAAA-MM-DD'. Respeta cambios de mes, año y años bisiestos. */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export type TipoVigencia = 'NUEVA' | 'REEMPLAZO' | 'REACTIVACION';

/**
 * Política de vigencia del CU-04: "la nueva membresía reemplaza a la anterior" (los días NO se apilan).
 *  - Con membresía vigente (su fin >= hoy) → REEMPLAZO: la anterior deja de contar y la nueva empieza hoy
 *    (solo si la nueva vence igual o después que la anterior; ver revisarReemplazo).
 *  - Con membresías pero todas vencidas → REACTIVACION: empieza hoy.
 *  - Sin membresías previas → NUEVA: empieza hoy.
 * Fin = inicio + duración − 1 (una Visita de 1 día empieza y termina el mismo día).
 * Ej.: tenía Mensual hasta diciembre y compra Anual hoy → solo queda la Anual (365 días desde hoy).
 * @param finActual fecha_fin de la membresía actual del cliente (la última vendida), null si nunca tuvo.
 */
export function calcularVigencia(hoy: string, finActual: string | null, duracionDias: number) {
  const tipo: TipoVigencia = !finActual ? 'NUEVA' : finActual >= hoy ? 'REEMPLAZO' : 'REACTIVACION';
  const inicio = hoy;
  return { tipo, inicio, fin: sumarDias(inicio, duracionDias) };
}

/**
 * Reglas del reemplazo cuando el cliente TIENE una membresía vigente (su fin >= hoy):
 *  - Si el plan nuevo vence ANTES que la actual → no se permite la venta (perdería días ya pagados).
 *  - Si no → se permite, pero se advierte que la fecha de vencimiento actual se sobrescribirá.
 * Sin membresía vigente no hay nada que revisar.
 * @returns bloqueo (mensaje si NO se puede vender) y advertencia (mensaje si se puede pero se sobrescribe).
 */
export function revisarReemplazo(hoy: string, finActual: string | null, finNuevo: string, planActual = 'actual') {
  if (!finActual || finActual < hoy) return { bloqueo: null, advertencia: null };
  if (finNuevo < finActual)
    return {
      bloqueo: `El plan elegido vence el ${finNuevo}, antes que la membresía ${planActual} (vence el ${finActual}). Elige un plan que cubra al menos hasta esa fecha.`,
      advertencia: null,
    };
  return {
    bloqueo: null,
    advertencia: `El cliente tiene la membresía ${planActual} vigente hasta el ${finActual}. Se sobrescribirá su fecha de vencimiento por el ${finNuevo}.`,
  };
}

/** Cambio en centavos para pago en efectivo, o null si el importe no alcanza. */
export function calcularCambio(totalCent: number, recibidoCent: number): number | null {
  return recibidoCent <= totalCent ? null : recibidoCent - totalCent;
}
