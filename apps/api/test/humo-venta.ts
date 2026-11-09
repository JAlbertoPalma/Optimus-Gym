// Pruebas de humo del CU-04 Registrar venta de membresía.
// Se ejecutan con la API encendida:  npm run api:probar:venta
// Requieren las migraciones hasta la 0004 y la semilla (npm run db:migrar && npm run db:semilla).
// Son RE-EJECUTABLES: cada corrida crea clientes nuevos con datos aleatorios, y los precios se leen
// del catálogo (no se asumen valores fijos).
// Las pruebas describen el comportamiento CORRECTO: si una falla, el error está en el código, no en la prueba.
import 'dotenv/config';
import { randomBytes, randomUUID } from 'crypto';

const base = `http://localhost:${process.env.PORT ?? 3000}`;
let ok = 0, fallos = 0;
function chequear(nombre: string, cond: boolean, extra = '') {
  console.log(`${cond ? '  ✔' : '  ✘'} ${nombre}${cond ? '' : '  → ' + extra}`);
  cond ? ok++ : fallos++;
}
async function llamar(m: string, ruta: string, cuerpo?: unknown) {
  const r = await fetch(base + ruta, { method: m, headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { estado: r.status, json: (await r.json().catch(() => ({}))) as any };
}
const digitos = (n: number) => Array.from(randomBytes(n), (b) => b % 10).join('');
async function crearCliente() {
  const r = await llamar('POST', '/api/v1/clientes', {
    nombres: 'Venta', apellidoPaterno: 'Prueba', fechaNacimiento: '1995-03-20', sexo: 'F',
    telefono: '56' + digitos(8), correo: `v${digitos(9)}@correo.com`,
    contactoEmergencia: { nombre: 'Contacto', telefono: '56' + digitos(8) },
    observacionesAcceso: 'Prueba CU-04 sin huella',
  });
  if (r.estado !== 201) throw new Error('No se pudo crear cliente de prueba: ' + JSON.stringify(r.json));
  return r.json.codigo as string;
}
const sumarDias = (f: string, d: number) => { const [a, m, dd] = f.split('-').map(Number); return new Date(Date.UTC(a, m - 1, dd + d)).toISOString().slice(0, 10); };

(async () => {
  console.log('Pruebas de humo · CU-04 Registrar venta de membresía');

  // ---- Catálogo ----
  let r = await llamar('GET', '/api/v1/ventas/catalogo');
  chequear('Catálogo → planes desde la BD y 3 métodos de pago', r.estado === 200 && r.json.planes?.length > 0 && r.json.metodosPago?.length === 3, JSON.stringify(r.json));
  chequear('Catálogo → indica quién atiende', !!r.json.atiende?.nombre, JSON.stringify(r.json.atiende));
  const planes: any[] = r.json.planes ?? [];
  const mensual = planes.find((p) => p.nombre === 'Mensual');
  const visita = planes.find((p) => p.nombre === 'Visita');
  const anual = planes.find((p) => p.nombre === 'Anual');
  if (!mensual || !visita || !anual) { console.log('  ✘ Faltan los planes Visita/Mensual/Anual: ejecuta npm run db:semilla'); process.exitCode = 1; return; }

  // ---- Cliente ----
  const c1 = await crearCliente();
  r = await llamar('GET', '/api/v1/ventas/clientes/' + c1);
  chequear('Estado de cliente nuevo → sin acceso hasta cobrar', r.estado === 200 && r.json.acceso?.permitido === false && r.json.acceso.motivo === 'Sin acceso hasta cobrar' && r.json.puedeComprar, JSON.stringify(r.json));
  const hoy: string = r.json.hoy;
  // ---- Planes nuevos ----
  const estudiante = planes.find((p) => p.nombre === 'Estudiante');
  chequear('Plan Estudiante disponible a $550', estudiante?.precio === 550, JSON.stringify(estudiante));
  const especial = planes.find((p) => p.nombre === 'Precio especial');
  const diaHoy = Number(hoy.slice(8, 10));
  // (la regla de los días se prueba completa en test/calculos-venta.ts con planDisponibleEn)
  if (diaHoy === 1 || diaHoy === 15)
    chequear(`Hoy es día ${diaHoy} → Precio especial visible a $550`, especial?.precio === 550, JSON.stringify(especial));
  else
    chequear(`Hoy es día ${diaHoy} → Precio especial NO aparece en el catálogo`, especial === undefined, JSON.stringify(especial));

  r = await llamar('GET', '/api/v1/ventas/clientes/OG-00000');
  chequear('Cliente inexistente → 404 NO_ENCONTRADO', r.estado === 404 && r.json.codigo === 'NO_ENCONTRADO', JSON.stringify(r.json));

  // ---- Cotizar ----
  r = await llamar('POST', '/api/v1/ventas/cotizar', { codigoCliente: c1, idTipo: mensual.idTipo });
  chequear('Cotizar Mensual → total = precio del plan', r.estado === 200 && r.json.total === mensual.precio, JSON.stringify(r.json));
  chequear('Cotizar no devuelve promociones (no existen en el sistema)', r.json.promociones === undefined && r.json.descuento === undefined, JSON.stringify(r.json));
  chequear('Cotizar calcula vigencia NUEVA de 30 días desde hoy', r.json.vigencia?.tipo === 'NUEVA' && r.json.vigencia.inicio === hoy && r.json.vigencia.fin === sumarDias(hoy, mensual.duracionDias - 1), JSON.stringify(r.json.vigencia));
  r = await llamar('POST', '/api/v1/ventas/cotizar', { codigoCliente: c1, idTipo: visita.idTipo });
  chequear('Cotizar Visita → empieza y termina hoy', r.json.vigencia?.inicio === hoy && r.json.vigencia?.fin === hoy, JSON.stringify(r.json.vigencia));
  r = await llamar('POST', '/api/v1/ventas/cotizar', { codigoCliente: c1, idTipo: 999999 });
  chequear('Plan inexistente → 404 PLAN_NO_DISPONIBLE', r.estado === 404 && r.json.codigo === 'PLAN_NO_DISPONIBLE', JSON.stringify(r.json));

  // ---- Validaciones al registrar ----
  const venta = (extra: any) => ({ claveIdempotencia: randomUUID(), codigoCliente: c1, idTipo: mensual.idTipo, metodoPago: 'EFECTIVO', importeRecibido: 50000, totalEsperado: mensual.precio, ...extra });
  r = await llamar('POST', '/api/v1/ventas', venta({ codigoCliente: '' }));
  chequear('Sin cliente → 422 con campo codigoCliente', r.estado === 422 && !!r.json.campos?.codigoCliente, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas', venta({ idTipo: undefined }));
  chequear('Sin plan → 422 con campo idTipo', r.estado === 422 && !!r.json.campos?.idTipo, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas', venta({ metodoPago: 'BITCOIN' }));
  chequear('Método de pago inválido → 422', r.estado === 422 && !!r.json.campos?.metodoPago, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas', venta({ importeRecibido: -10 }));
  chequear('Importe negativo → 422', r.estado === 422 && !!r.json.campos?.importeRecibido, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas', venta({ importeRecibido: mensual.precio - 0.01 }));
  chequear('Efectivo insuficiente → 422 IMPORTE_INSUFICIENTE', r.estado === 422 && r.json.codigo === 'IMPORTE_INSUFICIENTE', JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas', venta({ totalEsperado: 1 }));
  chequear('Precio manipulado/cambiado → 409 PRECIO_CAMBIO con total real', r.estado === 409 && r.json.codigo === 'PRECIO_CAMBIO' && r.json.total === mensual.precio, JSON.stringify(r.json));
  r = await llamar('GET', '/api/v1/ventas/clientes/' + c1);
  chequear('Tras los errores el cliente sigue sin membresía (nada a medias)', r.json.membresiaVigente === null && r.json.ultimoFin === null, JSON.stringify(r.json));

  // ---- Venta válida en efectivo ----
  const clave = randomUUID();
  const cuerpo = venta({ claveIdempotencia: clave, importeRecibido: mensual.precio + 50 });
  r = await llamar('POST', '/api/v1/ventas', cuerpo);
  const folio1 = r.json.folio;
  chequear('Venta Mensual en efectivo → 201 con folio', r.estado === 201 && /^V-\d{6}$/.test(folio1 ?? ''), JSON.stringify(r.json));
  const rec = r.json.recibo ?? {};
  chequear('Recibo: total, recibido y cambio $50', rec.total === mensual.precio && rec.importeRecibido === mensual.precio + 50 && rec.cambio === 50, JSON.stringify(rec));
  chequear('Recibo: cliente, plan, vigencia y empleado', rec.clienteCodigo === c1 && rec.plan === 'Mensual' && rec.fechaInicio === hoy && !!rec.empleadoNombre && rec.gimnasio === 'Optimus Gym', JSON.stringify(rec));

  // ---- Duplicados ----
  r = await llamar('POST', '/api/v1/ventas', cuerpo);
  chequear('Reenvío con la misma clave → 200 duplicada, mismo folio', r.estado === 200 && r.json.duplicada === true && r.json.folio === folio1, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas', { ...cuerpo, codigoCliente: await crearCliente() });
  chequear('Misma clave con otro cliente → 409 CLAVE_REUTILIZADA', r.estado === 409 && r.json.codigo === 'CLAVE_REUTILIZADA', JSON.stringify(r.json));

  // ---- Acceso ----
  r = await llamar('GET', '/api/v1/ventas/clientes/' + c1);
  const fin1 = sumarDias(hoy, mensual.duracionDias - 1);
  chequear('Tras cobrar → acceso permitido y membresía vigente', r.json.acceso?.permitido === true && r.json.membresiaVigente?.fechaFin === fin1, JSON.stringify(r.json));

  // ---- Membresía vigente con 7 días o más por delante → NO se puede reemplazar con ningún plan ----
  r = await llamar('POST', '/api/v1/ventas/cotizar', { codigoCliente: c1, idTipo: anual.idTipo });
  chequear('Cotizar Anual con Mensual recién comprada → bloqueo MEMBRESIA_VIGENTE (sin error HTTP)', r.estado === 200 && r.json.bloqueo?.codigo === 'MEMBRESIA_VIGENTE' && r.json.advertencia === null, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas', venta({ idTipo: anual.idTipo, totalEsperado: anual.precio, importeRecibido: anual.precio }));
  chequear('Registrar Anual con Mensual recién comprada → 409 MEMBRESIA_VIGENTE', r.estado === 409 && r.json.codigo === 'MEMBRESIA_VIGENTE', JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas', venta({ idTipo: visita.idTipo, totalEsperado: visita.precio, importeRecibido: visita.precio + 50 }));
  chequear('Registrar Visita con Mensual recién comprada → 409 MEMBRESIA_VIGENTE', r.estado === 409 && r.json.codigo === 'MEMBRESIA_VIGENTE', JSON.stringify(r.json));
  r = await llamar('GET', '/api/v1/ventas/clientes/' + c1);
  chequear('Tras los rechazos la Mensual sigue intacta', r.json.membresiaVigente?.plan === 'Mensual' && r.json.membresiaVigente?.fechaFin === fin1, JSON.stringify(r.json.membresiaVigente));

  // ---- Membresía con menos de 7 días por delante (Semanal) → se advierte y se sobrescribe (los días NO se apilan) ----
  const semanal = planes.find((p) => p.nombre === 'Semanal');
  chequear('Plan Semanal disponible a $200 por 7 días', semanal?.precio === 200 && semanal?.duracionDias === 7, JSON.stringify(semanal));
  const c6 = await crearCliente();
  r = await llamar('POST', '/api/v1/ventas', venta({ codigoCliente: c6, idTipo: semanal.idTipo, totalEsperado: semanal.precio }));
  const finSemanal = sumarDias(hoy, 6);
  chequear('Venta Semanal → vence en 6 días (7 días contando hoy)', r.estado === 201 && r.json.recibo?.fechaFin === finSemanal, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas/cotizar', { codigoCliente: c6, idTipo: mensual.idTipo });
  chequear('Cotizar Mensual con Semanal vigente (faltan 6 días) → REEMPLAZO desde hoy con advertencia de sobrescritura',
    r.json.vigencia?.tipo === 'REEMPLAZO' && r.json.vigencia.inicio === hoy && r.json.bloqueo === null && typeof r.json.advertencia === 'string' && r.json.advertencia.includes(finSemanal),
    JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas/cotizar', { codigoCliente: c6, idTipo: visita.idTipo });
  chequear('Cotizar Visita con Semanal vigente → bloqueo PLAN_VENCE_ANTES', r.json.bloqueo?.codigo === 'PLAN_VENCE_ANTES', JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas', venta({ codigoCliente: c6, metodoPago: 'TRANSFERENCIA', importeRecibido: undefined }));
  chequear('Semanal → Mensual por transferencia: la Mensual empieza HOY (no al terminar la Semanal)', r.estado === 201 && r.json.recibo?.fechaInicio === hoy && r.json.recibo?.fechaFin === fin1, JSON.stringify(r.json));
  chequear('Transferencia sin referencia → no guarda efectivo, cambio ni referencia', r.json.recibo?.importeRecibido === null && r.json.recibo?.cambio === null && !('referenciaPago' in (r.json.recibo ?? {})), JSON.stringify(r.json.recibo));
  r = await llamar('GET', '/api/v1/ventas/clientes/' + c6);
  chequear('Tras vender Mensual → la vigente es la Mensual (se sobrescribió el vencimiento de la Semanal)', r.json.membresiaVigente?.plan === 'Mensual' && r.json.membresiaVigente?.fechaFin === fin1, JSON.stringify(r.json.membresiaVigente));
  r = await llamar('GET', '/api/v1/ventas/' + folio1);
  chequear('El recibo anterior se conserva intacto (historial)', r.estado === 200 && r.json.fechaFin === fin1 && r.json.total === mensual.precio, JSON.stringify(r.json));
  r = await llamar('GET', '/api/v1/ventas/V-999999');
  chequear('Folio inexistente → 404', r.estado === 404, JSON.stringify(r.json));

  // ---- Concurrencia: doble clic (misma clave en paralelo) ----
  const c2 = await crearCliente();
  const dobleClic = venta({ codigoCliente: c2, importeRecibido: mensual.precio + 100 });
  const [a, b] = await Promise.all([llamar('POST', '/api/v1/ventas', dobleClic), llamar('POST', '/api/v1/ventas', dobleClic)]);
  chequear('Doble clic simultáneo → una venta nueva y una duplicada con el mismo folio',
    [a.estado, b.estado].sort().join() === '200,201' && a.json.folio === b.json.folio, JSON.stringify([a.estado, a.json, b.estado, b.json]));

  // ---- Concurrencia: dos ventas distintas del mismo cliente → la segunda ve la primera y se rechaza ----
  const c3 = await crearCliente();
  const [x, y] = await Promise.all([
    llamar('POST', '/api/v1/ventas', venta({ codigoCliente: c3, importeRecibido: mensual.precio + 100 })),
    llamar('POST', '/api/v1/ventas', venta({ codigoCliente: c3, importeRecibido: mensual.precio + 100 })),
  ]);
  chequear('Dos cobros simultáneos del mismo cliente → uno 201 y el otro 409 MEMBRESIA_VIGENTE (no se cobra dos veces)',
    [x.estado, y.estado].sort().join() === '201,409' && [x.json.codigo, y.json.codigo].includes('MEMBRESIA_VIGENTE'), JSON.stringify([x.json, y.json]));

  // ---- Pago exacto (cliente sin membresía) ----
  r = await llamar('POST', '/api/v1/ventas', venta({ codigoCliente: await crearCliente(), idTipo: visita.idTipo, totalEsperado: visita.precio, importeRecibido: visita.precio }));
  chequear('Visita con pago exacto → 201 con cambio $0', r.estado === 201 && r.json.recibo?.cambio === 0, JSON.stringify(r.json));

  // ---- Cliente inactivo ----
  const c4 = await crearCliente();
  await llamar('POST', `/api/v1/clientes/${c4}/baja`, { motivo: 'Prueba CU-04' });
  r = await llamar('POST', '/api/v1/ventas', venta({ codigoCliente: c4, importeRecibido: mensual.precio + 100 }));
  chequear('Cliente inactivo → 409 CLIENTE_INACTIVO', r.estado === 409 && r.json.codigo === 'CLIENTE_INACTIVO', JSON.stringify(r.json));

  console.log(`\nResultado: ${ok} correctas, ${fallos} fallidas`);
  process.exitCode = fallos ? 1 : 0;
})();
