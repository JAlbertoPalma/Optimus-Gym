// CÁLCULOS DEL CU-04 (funciones puras: no tocan la BD ni la red).
// Las usa ventas.service.ts y se prueban directamente en test/calculos-venta.ts.
//
// Dinero: se trabaja en CENTAVOS enteros. Con decimales de JavaScript, 0.1 + 0.2 = 0.30000000000000004;
// con enteros no hay redondeos sorpresa. Solo al responder se convierte de vuelta a pesos.
// Fechas: siempre texto 'AAAA-MM-DD' y aritmética en UTC, así el huso horario del servidor
// no recorre un día. La fecha "hoy" la da PostgreSQL (CURRENT_DATE) para que coincida con la BD.

/** "600.00" (NUMERIC de PostgreSQL) o 600 → 60000 centavos.
 *  Se REDONDEA (no se trunca): 600.30 * 100 = 60029.999… en JavaScript y con Math.floor se perdía un centavo (H-03). */
export const aCentavos = (v: string | number) => Math.round(Number(v) * 100);
/** 60000 → 600 (pesos con dos decimales como número). */
export const aPesos = (c: number) => c / 100;

/** Suma días a una fecha 'AAAA-MM-DD'. Respeta cambios de mes, año y años bisiestos. */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * ¿Se puede vender el plan en la fecha "hoy"? Algunos planes solo se venden ciertos días del mes
 * (tipo_membresia.dias_disponibles, ej. [1, 15]); null o vacío = todos los días.
 */
export function planDisponibleEn(diasDisponibles: number[] | null, hoy: string): boolean {
  if (!diasDisponibles || !diasDisponibles.length) return true;
  return diasDisponibles.includes(Number(hoy.slice(8, 10)));
}

export type TipoVigencia = 'NUEVA' | 'REEMPLAZO' | 'REACTIVACION';

/**
 * Política de vigencia del CU-04: "la nueva membresía reemplaza a la anterior" (los días NO se apilan).
 *  - Con membresía vigente (su fin >= hoy) → REEMPLAZO: la anterior deja de contar y la nueva empieza hoy
 *    (solo si a la anterior le faltan menos de 7 días y la nueva vence después; ver revisarReemplazo).
 *  - Con membresías pero todas vencidas → REACTIVACION: empieza hoy.
 *  - Sin membresías previas → NUEVA: empieza hoy.
 * Fin = inicio + duración − 1 (una Visita de 1 día empieza y termina el mismo día).
 * Ej.: a su Mensual le quedan 3 días y compra Anual hoy → solo queda la Anual (365 días desde hoy).
 * @param finActual fecha_fin de la membresía actual del cliente (la última vendida), null si nunca tuvo.
 */
export function calcularVigencia(hoy: string, finActual: string | null, duracionDias: number) {
  const tipo: TipoVigencia = !finActual ? 'NUEVA' : finActual >= hoy ? 'REEMPLAZO' : 'REACTIVACION';
  const inicio = hoy;
  // − 1 porque el día de inicio ya cuenta: una Visita (1 día) vence el mismo día y una Mensual (30) el día 30 (H-01)
  return { tipo, inicio, fin: sumarDias(inicio, duracionDias - 1) };
}

/** Días de 'desde' a 'hasta' (fechas 'AAAA-MM-DD'). Ej.: del 2026-11-09 al 2026-11-15 → 6. */
export function diasEntre(desde: string, hasta: string): number {
  const utc = (f: string) => { const [a, m, d] = f.split('-').map(Number); return Date.UTC(a, m - 1, d); };
  return Math.round((utc(hasta) - utc(desde)) / 86_400_000);
}

/** Una membresía vigente solo se puede reemplazar cuando le faltan MENOS de estos días para vencer. */
export const DIAS_PARA_REEMPLAZAR = 7;

export interface BloqueoReemplazo { codigo: 'MEMBRESIA_VIGENTE' | 'PLAN_VENCE_ANTES'; mensaje: string }

/**
 * Reglas del reemplazo cuando el cliente TIENE una membresía vigente (su fin >= hoy):
 *  - Si le faltan 7 días o más para vencer → MEMBRESIA_VIGENTE: no se vende (aún le queda mucho plan).
 *    Ej.: hoy 2026-11-09, vence el 2026-11-16 (faltan 7) → bloqueo; vence el 2026-11-15 (faltan 6) → se puede.
 *  - Si el plan nuevo vence el MISMO día o antes que la actual → PLAN_VENCE_ANTES: no se vende (no le agrega días).
 *  - Si no → se permite, pero se advierte que la fecha de vencimiento actual se sobrescribirá.
 * Sin membresía vigente no hay nada que revisar.
 * @returns bloqueo (si NO se puede vender) y advertencia (mensaje si se puede pero se sobrescribe).
 */
export function revisarReemplazo(hoy: string, finActual: string | null, finNuevo: string, planActual = 'actual')
  : { bloqueo: BloqueoReemplazo | null; advertencia: string | null } {
  if (!finActual || finActual < hoy) return { bloqueo: null, advertencia: null };
  const restantes = diasEntre(hoy, finActual);
  if (restantes >= DIAS_PARA_REEMPLAZAR)
    return {
      bloqueo: {
        codigo: 'MEMBRESIA_VIGENTE',
        mensaje: `La membresía ${planActual} vence el ${finActual} (faltan ${restantes} días). Solo se puede reemplazar cuando falten menos de ${DIAS_PARA_REEMPLAZAR} días.`,
      },
      advertencia: null,
    };
  if (finNuevo <= finActual)
    return {
      bloqueo: {
        codigo: 'PLAN_VENCE_ANTES',
        mensaje: `El plan elegido vence el ${finNuevo}, el mismo día o antes que la membresía ${planActual} (vence el ${finActual}). Elige un plan que dure más.`,
      },
      advertencia: null,
    };
  return {
    bloqueo: null,
    advertencia: `El cliente tiene la membresía ${planActual} vigente hasta el ${finActual}. Se sobrescribirá su fecha de vencimiento por el ${finNuevo}.`,
  };
}

/** Cambio en centavos para pago en efectivo, o null si el importe no alcanza.
 *  El importe exacto SÍ alcanza (cambio 0): solo un importe MENOR al total es insuficiente (H-02). */
export function calcularCambio(totalCent: number, recibidoCent: number): number | null {
  return recibidoCent < totalCent ? null : recibidoCent - totalCent;
}
