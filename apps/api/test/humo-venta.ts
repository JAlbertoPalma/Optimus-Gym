// Pruebas de humo del CU-04 Registrar venta de membresía.
// Se ejecutan con la API encendida:  npm run api:probar:venta
// Requieren la migración 0003 y la semilla (npm run db:migrar && npm run db:semilla).
// Son RE-EJECUTABLES: cada corrida crea clientes nuevos con datos aleatorios, y los precios se leen
// del catálogo (no se asumen valores fijos).
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
async function crearCliente(fechaNacimiento = '1995-03-20') {
  const r = await llamar('POST', '/api/v1/clientes', {
    nombres: 'Venta', apellidoPaterno: 'Prueba', fechaNacimiento, sexo: 'F',
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
  const planes: any[] = r.json.planes ?? [];
  const mensual = planes.find((p) => p.nombre === 'Mensual');
  const visita = planes.find((p) => p.nombre === 'Visita');
  if (!mensual || !visita) { console.log('  ✘ Faltan los planes Mensual/Visita: ejecuta npm run db:semilla'); process.exitCode = 1; return; }

  // ---- Cliente ----
  const c1 = await crearCliente();
  r = await llamar('GET', '/api/v1/ventas/clientes/' + c1);
  chequear('Estado de cliente nuevo → sin acceso hasta cobrar', r.estado === 200 && r.json.acceso?.permitido === false && r.json.acceso.motivo === 'Sin acceso hasta cobrar' && r.json.puedeComprar, JSON.stringify(r.json));
  const hoy: string = r.json.hoy;
  r = await llamar('GET', '/api/v1/ventas/clientes/OG-00000');
  chequear('Cliente inexistente → 404 NO_ENCONTRADO', r.estado === 404 && r.json.codigo === 'NO_ENCONTRADO', JSON.stringify(r.json));

  // ---- Cotizar ----
  r = await llamar('POST', '/api/v1/ventas/cotizar', { codigoCliente: c1, idTipo: mensual.idTipo });
  chequear('Cotizar Mensual sin promoción → total = precio', r.estado === 200 && r.json.total === mensual.precio && r.json.descuento === 0, JSON.stringify(r.json));
  chequear('Cotizar calcula vigencia NUEVA desde hoy', r.json.vigencia?.tipo === 'NUEVA' && r.json.vigencia.inicio === hoy && r.json.vigencia.fin === sumarDias(hoy, mensual.duracionDias - 1), JSON.stringify(r.json.vigencia));
  const promos: any[] = r.json.promociones ?? [];
  const estudiante = promos.find((p) => p.nombre === 'Estudiante');
  const adulto = promos.find((p) => p.nombre === 'Adulto mayor');
  const regreso = promos.find((p) => p.nombre === 'Regreso a clases');
  chequear('Promociones de la semilla presentes', !!estudiante && !!adulto && !!regreso, JSON.stringify(promos.map((p) => p.nombre)));
  chequear('Adulto mayor NO aplicable a cliente de 30 años', adulto?.aplicable === false, JSON.stringify(adulto));

  r = await llamar('POST', '/api/v1/ventas/cotizar', { codigoCliente: c1, idTipo: mensual.idTipo, idPromocion: estudiante.idPromocion });
  const totalEst = mensual.precio - 50;
  chequear('Cotizar con Estudiante → descuento $50', r.estado === 200 && r.json.descuento === 50 && r.json.total === totalEst, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas/cotizar', { codigoCliente: c1, idTipo: visita.idTipo, idPromocion: estudiante.idPromocion });
  chequear('Estudiante en plan Visita → 422 PROMOCION_NO_APLICA', r.estado === 422 && r.json.codigo === 'PROMOCION_NO_APLICA', JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas/cotizar', { codigoCliente: c1, idTipo: mensual.idTipo, idPromocion: adulto.idPromocion });
  chequear('Adulto mayor con cliente joven → 422 REQUISITO_NO_CUMPLIDO', r.estado === 422 && r.json.codigo === 'REQUISITO_NO_CUMPLIDO', JSON.stringify(r.json));
  if (!regreso.aplicable) {
    r = await llamar('POST', '/api/v1/ventas/cotizar', { codigoCliente: c1, idTipo: mensual.idTipo, idPromocion: regreso.idPromocion });
    chequear('Regreso a clases fuera de periodo → 422 PROMOCION_VENCIDA/NO_VIGENTE', r.estado === 422 && /PROMOCION_(VENCIDA|NO_VIGENTE)/.test(r.json.codigo), JSON.stringify(r.json));
  }
  r = await llamar('POST', '/api/v1/ventas/cotizar', { codigoCliente: c1, idTipo: 999999 });
  chequear('Plan inexistente → 404 PLAN_NO_DISPONIBLE', r.estado === 404 && r.json.codigo === 'PLAN_NO_DISPONIBLE', JSON.stringify(r.json));

  // ---- Validaciones al registrar ----
  const venta = (extra: any) => ({ claveIdempotencia: randomUUID(), codigoCliente: c1, idTipo: mensual.idTipo, metodoPago: 'EFECTIVO', importeRecibido: 5000, totalEsperado: mensual.precio, ...extra });
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
  r = await llamar('POST', '/api/v1/ventas', venta({ idPromocion: estudiante.idPromocion, totalEsperado: totalEst }));
  chequear('Promoción con documento sin verificación → 422 VERIFICACION_REQUERIDA', r.estado === 422 && r.json.codigo === 'VERIFICACION_REQUERIDA', JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas', venta({ metodoPago: 'TARJETA', importeRecibido: undefined }));
  chequear('Tarjeta sin referencia → 422 REFERENCIA_REQUERIDA', r.estado === 422 && r.json.codigo === 'REFERENCIA_REQUERIDA', JSON.stringify(r.json));
  r = await llamar('GET', '/api/v1/ventas/clientes/' + c1);
  chequear('Tras los errores el cliente sigue sin membresía (nada a medias)', r.json.membresiaVigente === null && r.json.ultimoFin === null, JSON.stringify(r.json));

  // ---- Venta válida en efectivo con promoción ----
  const clave = randomUUID();
  const cuerpo = venta({ claveIdempotencia: clave, idPromocion: estudiante.idPromocion, verificacionRequisito: 'Credencial ITSON 2026', totalEsperado: totalEst, importeRecibido: totalEst + 95 });
  r = await llamar('POST', '/api/v1/ventas', cuerpo);
  const folio1 = r.json.folio;
  chequear('Venta efectivo + Estudiante → 201 con folio', r.estado === 201 && /^V-\d{6}$/.test(folio1 ?? ''), JSON.stringify(r.json));
  const rec = r.json.recibo ?? {};
  chequear('Recibo: total, descuento, recibido y cambio $95', rec.total === totalEst && rec.descuento === 50 && rec.importeRecibido === totalEst + 95 && rec.cambio === 95, JSON.stringify(rec));
  chequear('Recibo: cliente, plan, vigencia y empleado', rec.clienteCodigo === c1 && rec.plan === 'Mensual' && rec.fechaInicio === hoy && !!rec.empleadoNombre && rec.gimnasio === 'Optimus Gym', JSON.stringify(rec));
  chequear('Recibo guarda la promoción y la verificación', rec.descripcionDescuento?.includes('estudiante') && rec.verificacionRequisito === 'Credencial ITSON 2026', JSON.stringify(rec));

  // ---- Duplicados ----
  r = await llamar('POST', '/api/v1/ventas', cuerpo);
  chequear('Reenvío con la misma clave → 200 duplicada, mismo folio', r.estado === 200 && r.json.duplicada === true && r.json.folio === folio1, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas', { ...cuerpo, codigoCliente: await crearCliente() });
  chequear('Misma clave con otro cliente → 409 CLAVE_REUTILIZADA', r.estado === 409 && r.json.codigo === 'CLAVE_REUTILIZADA', JSON.stringify(r.json));

  // ---- Acceso y renovación ----
  r = await llamar('GET', '/api/v1/ventas/clientes/' + c1);
  const fin1 = sumarDias(hoy, mensual.duracionDias - 1);
  chequear('Tras cobrar → acceso permitido y membresía vigente', r.json.acceso?.permitido === true && r.json.membresiaVigente?.fechaFin === fin1, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/ventas', venta({ idTipo: visita.idTipo, metodoPago: 'TRANSFERENCIA', importeRecibido: undefined, referenciaPago: 'RASTREO123', totalEsperado: visita.precio }));
  chequear('Renovación por transferencia → 201', r.estado === 201, JSON.stringify(r.json));
  chequear('Renovación empieza el día siguiente al vencimiento (no pierde días)', r.json.recibo?.fechaInicio === sumarDias(fin1, 1) && r.json.recibo?.importeRecibido === null && r.json.recibo?.referenciaPago === 'RASTREO123', JSON.stringify(r.json.recibo));
  r = await llamar('GET', '/api/v1/ventas/' + folio1);
  chequear('El recibo anterior se conserva intacto (historial)', r.estado === 200 && r.json.fechaFin === fin1 && r.json.total === totalEst, JSON.stringify(r.json));
  r = await llamar('GET', '/api/v1/ventas/V-999999');
  chequear('Folio inexistente → 404', r.estado === 404, JSON.stringify(r.json));

  // ---- Concurrencia: doble clic (misma clave en paralelo) ----
  const c2 = await crearCliente();
  const dobleClic = venta({ codigoCliente: c2, importeRecibido: mensual.precio });
  const [a, b] = await Promise.all([llamar('POST', '/api/v1/ventas', dobleClic), llamar('POST', '/api/v1/ventas', dobleClic)]);
  chequear('Doble clic simultáneo → una venta nueva y una duplicada con el mismo folio',
    [a.estado, b.estado].sort().join() === '200,201' && a.json.folio === b.json.folio, JSON.stringify([a.estado, a.json, b.estado, b.json]));

  // ---- Concurrencia: dos ventas distintas del mismo cliente → se encadenan, no se traslapan ----
  const c3 = await crearCliente();
  const [x, y] = await Promise.all([
    llamar('POST', '/api/v1/ventas', venta({ codigoCliente: c3, importeRecibido: mensual.precio })),
    llamar('POST', '/api/v1/ventas', venta({ codigoCliente: c3, importeRecibido: mensual.precio })),
  ]);
  const inicios = [x.json.recibo?.fechaInicio, y.json.recibo?.fechaInicio].sort();
  chequear('Dos cobros simultáneos del mismo cliente → vigencias consecutivas', x.estado === 201 && y.estado === 201 && inicios[0] === hoy && inicios[1] === sumarDias(fin1, 1),
    JSON.stringify([x.json, y.json]));

  // ---- Cliente inactivo ----
  const c4 = await crearCliente();
  await llamar('POST', `/api/v1/clientes/${c4}/baja`, { motivo: 'Prueba CU-04' });
  r = await llamar('POST', '/api/v1/ventas', venta({ codigoCliente: c4, importeRecibido: mensual.precio }));
  chequear('Cliente inactivo → 409 CLIENTE_INACTIVO', r.estado === 409 && r.json.codigo === 'CLIENTE_INACTIVO', JSON.stringify(r.json));

  // ---- Adulto mayor válido ----
  const c5 = await crearCliente('1955-06-15');
  r = await llamar('POST', '/api/v1/ventas', venta({ codigoCliente: c5, idPromocion: adulto.idPromocion, verificacionRequisito: 'INE', totalEsperado: totalEst, importeRecibido: totalEst }));
  chequear('Adulto mayor (71 años) con INE, pago exacto → 201 con cambio $0', r.estado === 201 && r.json.recibo?.cambio === 0, JSON.stringify(r.json));

  console.log(`\nResultado: ${ok} correctas, ${fallos} fallidas`);
  process.exitCode = fallos ? 1 : 0;
})();
