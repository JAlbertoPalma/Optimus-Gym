// Pruebas UNITARIAS de los cálculos del CU-04 (src/ventas/calculos-venta.ts).
// No necesitan la API ni la base de datos:  npm run api:probar:calculos
import {
  aCentavos, calcularCambio, calcularDescuento, calcularVigencia, edadEn, evaluarPromocion, sumarDias,
} from '../src/ventas/calculos-venta';

let ok = 0, fallos = 0;
function chequear(nombre: string, cond: boolean, extra: unknown = '') {
  console.log(`${cond ? '  ✔' : '  ✘'} ${nombre}${cond ? '' : '  → ' + JSON.stringify(extra)}`);
  cond ? ok++ : fallos++;
}

console.log('Pruebas unitarias · CU-04 cálculos de venta');

// ---- Dinero ----
chequear('"600.00" → 60000 centavos', aCentavos('600.00') === 60000);
chequear('0.1 + 0.2 en centavos sin error de redondeo', aCentavos(0.1) + aCentavos(0.2) === 30);
chequear('Descuento MONTO $50 sobre $600 = $50', calcularDescuento(60000, 'MONTO', '50.00') === 5000);
chequear('Descuento 10% sobre $450 = $45', calcularDescuento(45000, 'PORCENTAJE', 10) === 4500);
chequear('Descuento 10% sobre $455.55 redondea a $45.56', calcularDescuento(45555, 'PORCENTAJE', 10) === 4556, calcularDescuento(45555, 'PORCENTAJE', 10));
chequear('Descuento mayor al precio → se limita (total nunca negativo)', calcularDescuento(5000, 'MONTO', 80) === 5000);
chequear('Cambio: total $405, recibe $500 → $95', calcularCambio(40500, 50000) === 9500);
chequear('Cambio: recibe exacto → $0', calcularCambio(55000, 55000) === 0);
chequear('Cambio: importe insuficiente → null', calcularCambio(55000, 54999) === null);

// ---- Fechas ----
chequear('Suma días cruza mes', sumarDias('2026-01-31', 1) === '2026-02-01');
chequear('Suma días cruza año', sumarDias('2026-12-15', 29) === '2027-01-13', sumarDias('2026-12-15', 29));
chequear('Año bisiesto (2028-02-28 + 1 = 02-29)', sumarDias('2028-02-28', 1) === '2028-02-29');
chequear('Edad: un día antes del cumpleaños', edadEn('1966-11-02', '2026-11-01') === 59);
chequear('Edad: el día del cumpleaños', edadEn('1966-11-01', '2026-11-01') === 60);

// ---- Vigencia ("extender sin perder días") ----
let v = calcularVigencia('2026-11-01', null, 30);
chequear('Sin membresías → NUEVA desde hoy, 30 días', v.tipo === 'NUEVA' && v.inicio === '2026-11-01' && v.fin === '2026-11-30', v);
v = calcularVigencia('2026-11-01', null, 1);
chequear('Visita (1 día) empieza y termina hoy', v.inicio === '2026-11-01' && v.fin === '2026-11-01', v);
v = calcularVigencia('2026-11-01', '2026-11-10', 30);
chequear('Vigente → RENOVACION desde el día siguiente al vencimiento', v.tipo === 'RENOVACION' && v.inicio === '2026-11-11' && v.fin === '2026-12-10', v);
v = calcularVigencia('2026-11-01', '2026-11-01', 30);
chequear('Vence hoy → RENOVACION desde mañana', v.tipo === 'RENOVACION' && v.inicio === '2026-11-02', v);
v = calcularVigencia('2026-11-01', '2026-10-31', 90);
chequear('Vencida ayer → REACTIVACION desde hoy', v.tipo === 'REACTIVACION' && v.inicio === '2026-11-01' && v.fin === '2027-01-29', v);
v = calcularVigencia('2026-12-20', null, 365);
chequear('Anual cruzando año', v.fin === '2027-12-19', v);

// ---- Promociones ----
const base = { activa: true, fechaInicio: null, fechaFin: null, edadMinima: null, planes: [2] };
chequear('Promo vigente y del plan → aplicable', evaluarPromocion(base, 2, '2026-11-01', null) === null);
chequear('Promo de otro plan → PROMOCION_NO_APLICA', evaluarPromocion(base, 1, '2026-11-01', null)?.codigo === 'PROMOCION_NO_APLICA');
chequear('Promo vencida → PROMOCION_VENCIDA',
  evaluarPromocion({ ...base, fechaInicio: '2026-08-01', fechaFin: '2026-09-30' }, 2, '2026-11-01', null)?.codigo === 'PROMOCION_VENCIDA');
chequear('Promo aún no inicia → PROMOCION_NO_VIGENTE',
  evaluarPromocion({ ...base, fechaInicio: '2026-12-01' }, 2, '2026-11-01', null)?.codigo === 'PROMOCION_NO_VIGENTE');
chequear('Último día de la promo → aplicable', evaluarPromocion({ ...base, fechaFin: '2026-11-01' }, 2, '2026-11-01', null) === null);
chequear('Promo inactiva → no disponible', evaluarPromocion({ ...base, activa: false }, 2, '2026-11-01', null)?.codigo === 'PROMOCION_NO_DISPONIBLE');
const mayor = { ...base, edadMinima: 60 };
chequear('Edad mínima sin cliente → CLIENTE_REQUERIDO', evaluarPromocion(mayor, 2, '2026-11-01', null)?.codigo === 'CLIENTE_REQUERIDO');
chequear('Edad mínima no cumplida → REQUISITO_NO_CUMPLIDO', evaluarPromocion(mayor, 2, '2026-11-01', '1990-01-01')?.codigo === 'REQUISITO_NO_CUMPLIDO');
chequear('Edad mínima cumplida → aplicable', evaluarPromocion(mayor, 2, '2026-11-01', '1960-05-05') === null);

console.log(`\nResultado: ${ok} correctas, ${fallos} fallidas`);
process.exitCode = fallos ? 1 : 0;
