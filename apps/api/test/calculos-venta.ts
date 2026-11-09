// Pruebas UNITARIAS de los cálculos del CU-04 (src/ventas/calculos-venta.ts).
// No necesitan la API ni la base de datos:  npm run api:probar:calculos
// Las pruebas describen el comportamiento CORRECTO: si una falla, el error está en el código, no en la prueba.
import {
  aCentavos, calcularCambio, calcularVigencia, diasEntre, planDisponibleEn, revisarReemplazo, sumarDias,
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
chequear('$19.99 → 1999 centavos', aCentavos(19.99) === 1999, aCentavos(19.99));
chequear('$1,234.56 → 123456 centavos', aCentavos('1234.56') === 123456, aCentavos('1234.56'));
chequear('Cambio: total $550, recibe $600 → $50', calcularCambio(55000, 60000) === 5000, calcularCambio(55000, 60000));
chequear('Cambio: recibe exacto → $0', calcularCambio(55000, 55000) === 0, calcularCambio(55000, 55000));
chequear('Cambio: importe insuficiente → null', calcularCambio(55000, 54999) === null);

// ---- Fechas ----
chequear('Suma días cruza mes', sumarDias('2026-01-31', 1) === '2026-02-01');
chequear('Suma días cruza año', sumarDias('2026-12-15', 29) === '2027-01-13', sumarDias('2026-12-15', 29));
chequear('Año bisiesto (2028-02-28 + 1 = 02-29)', sumarDias('2028-02-28', 1) === '2028-02-29');

// ---- Planes que solo se venden ciertos días del mes ----
chequear('Plan sin restricción → disponible cualquier día', planDisponibleEn(null, '2026-11-09') && planDisponibleEn([], '2026-11-09'));
chequear('Precio especial [1, 15] → disponible el día 1', planDisponibleEn([1, 15], '2026-11-01'));
chequear('Precio especial [1, 15] → disponible el día 15', planDisponibleEn([1, 15], '2026-11-15'));
chequear('Precio especial [1, 15] → NO disponible el día 16', !planDisponibleEn([1, 15], '2026-11-16'));
chequear('Precio especial [1, 15] → NO disponible el día 31', !planDisponibleEn([1, 15], '2026-12-31'));

// ---- Vigencia ("la nueva reemplaza a la anterior", sin apilar días) ----
let v = calcularVigencia('2026-11-01', null, 30);
chequear('Sin membresías → NUEVA desde hoy, 30 días', v.tipo === 'NUEVA' && v.inicio === '2026-11-01' && v.fin === '2026-11-30', v);
v = calcularVigencia('2026-11-01', null, 1);
chequear('Visita (1 día) empieza y termina hoy', v.inicio === '2026-11-01' && v.fin === '2026-11-01', v);
v = calcularVigencia('2026-11-01', '2026-11-10', 30);
chequear('Vigente → REEMPLAZO desde hoy (no se suman los días que le quedaban)', v.tipo === 'REEMPLAZO' && v.inicio === '2026-11-01' && v.fin === '2026-11-30', v);
v = calcularVigencia('2026-11-01', '2026-11-30', 365);
chequear('Tenía Mensual y compra Anual → la Anual la sustituye desde hoy (fin en 365 días)', v.tipo === 'REEMPLAZO' && v.inicio === '2026-11-01' && v.fin === '2027-10-31', v);
v = calcularVigencia('2026-11-01', '2026-11-01', 30);
chequear('Vence hoy → REEMPLAZO desde hoy', v.tipo === 'REEMPLAZO' && v.inicio === '2026-11-01', v);
v = calcularVigencia('2026-11-01', '2026-10-31', 90);
chequear('Vencida ayer → REACTIVACION desde hoy', v.tipo === 'REACTIVACION' && v.inicio === '2026-11-01' && v.fin === '2027-01-29', v);
v = calcularVigencia('2026-12-20', null, 365);
chequear('Anual cruzando año', v.fin === '2027-12-19', v);

// ---- Reemplazo de una membresía vigente ----
let rr = revisarReemplazo('2026-11-01', null, '2026-11-30');
chequear('Sin membresía → ni bloqueo ni advertencia', rr.bloqueo === null && rr.advertencia === null, rr);
rr = revisarReemplazo('2026-11-01', '2026-10-31', '2026-11-30');
chequear('Membresía vencida → ni bloqueo ni advertencia', rr.bloqueo === null && rr.advertencia === null, rr);
chequear('diasEntre: del 9 al 15 de noviembre → 6', diasEntre('2026-11-09', '2026-11-15') === 6);
chequear('diasEntre: cruza año (31 dic → 1 ene) → 1', diasEntre('2026-12-31', '2027-01-01') === 1);
// Con 7 días o más por delante, la membresía vigente NO se puede reemplazar, sin importar el plan nuevo
rr = revisarReemplazo('2026-11-01', '2027-01-29', '2027-10-31', 'Trimestral');
chequear('Trimestral con 89 días restantes → Anual bloqueado (MEMBRESIA_VIGENTE)', rr.bloqueo?.codigo === 'MEMBRESIA_VIGENTE' && rr.advertencia === null, rr);
rr = revisarReemplazo('2026-11-01', '2026-11-08', '2026-11-30', 'Mensual');
chequear('Faltan exactamente 7 días → bloqueado (MEMBRESIA_VIGENTE)', rr.bloqueo?.codigo === 'MEMBRESIA_VIGENTE', rr);
// Con menos de 7 días, se puede reemplazar si el plan nuevo vence DESPUÉS
rr = revisarReemplazo('2026-11-01', '2026-11-07', '2026-11-30', 'Mensual');
chequear('Faltan 6 días y la nueva vence después → advertencia de sobrescritura', rr.bloqueo === null && !!rr.advertencia && rr.advertencia.includes('2026-11-07'), rr);
rr = revisarReemplazo('2026-11-01', '2026-11-01', '2026-11-07', 'Semanal');
chequear('La vigente vence hoy → se permite con advertencia', rr.bloqueo === null && !!rr.advertencia, rr);
rr = revisarReemplazo('2026-11-01', '2026-11-05', '2026-11-01', 'Mensual');
chequear('Faltan 4 días y la nueva (Visita) vence antes → PLAN_VENCE_ANTES', rr.bloqueo?.codigo === 'PLAN_VENCE_ANTES', rr);
rr = revisarReemplazo('2026-11-01', '2026-11-05', '2026-11-05', 'Mensual');
chequear('La nueva vence el MISMO día que la vigente → PLAN_VENCE_ANTES (no se permite)', rr.bloqueo?.codigo === 'PLAN_VENCE_ANTES', rr);
rr = revisarReemplazo('2026-11-01', '2026-11-01', '2026-11-01');
chequear('Vence hoy y la nueva es Visita (vence hoy también) → PLAN_VENCE_ANTES', rr.bloqueo?.codigo === 'PLAN_VENCE_ANTES', rr);

console.log(`\nResultado: ${ok} correctas, ${fallos} fallidas`);
process.exitCode = fallos ? 1 : 0;
