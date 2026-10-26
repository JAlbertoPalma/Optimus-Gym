import 'dotenv/config';
const base = `http://localhost:${process.env.PORT ?? 3000}`;
let ok = 0, fallos = 0;
function chequear(nombre: string, cond: boolean, extra = '') {
  console.log(`${cond ? '  ✔' : '  ✘'} ${nombre}${cond ? '' : '  → ' + extra}`);
  cond ? ok++ : fallos++;
}
async function llamar(m: string, ruta: string, cuerpo?: unknown) {
  const r = await fetch(base + ruta, { method: m, headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { estado: r.status, json: (await r.json()) as any };
}
const sufijo = Date.now().toString().slice(-6);
const plantilla = (n: number) => Buffer.from(Array.from({ length: 64 }, (_, i) => (i * n + 7) % 256)).toString('base64');
const alta = (o: any = {}) => ({
  nombres: 'Ana', apellidoPaterno: 'López', apellidoMaterno: 'Ruiz', fechaNacimiento: '1998-05-14', sexo: 'F',
  telefono: '644' + sufijo + '1', correo: `ana${sufijo}@correo.com`,
  contactoEmergencia: { nombre: 'Luis López', telefono: '6441112233', parentesco: 'Padre' },
  huella: { dedo: 2, plantillaBase64: plantilla(3), calidad: 88 }, ...o,
});

(async () => {
  console.log('Pruebas de humo · CU-02 registrarCliente');
  let r = await llamar('GET', '/health');
  chequear('GET /health responde ok', r.estado === 200 && r.json.estado === 'ok');

  r = await llamar('POST', '/api/v1/clientes', alta());
  chequear('FB-01 alta con huella → 201 y código OG-', r.estado === 201 && /^OG-\d{5}$/.test(r.json.codigo), JSON.stringify(r.json));

  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '644' + sufijo + '9', huella: { dedo: 3, plantillaBase64: plantilla(5), calidad: 90 } }));
  chequear('FA-01 correo repetido → 409 DUPLICADO', r.estado === 409 && r.json.codigo === 'DUPLICADO', JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/clientes', alta({ correo: `otro${sufijo}@correo.com`, huella: { dedo: 3, plantillaBase64: plantilla(5), calidad: 90 } }));
  chequear('FA-01 teléfono repetido → 409 DUPLICADO', r.estado === 409 && r.json.codigo === 'DUPLICADO', JSON.stringify(r.json));

  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '644' + sufijo + '2', correo: `b${sufijo}@correo.com` }));
  chequear('FA-05 huella duplicada → 409 HUELLA_DUPLICADA', r.estado === 409 && r.json.codigo === 'HUELLA_DUPLICADA', JSON.stringify(r.json));

  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '644' + sufijo + '3', correo: `c${sufijo}@correo.com`, huella: { dedo: 2, plantillaBase64: plantilla(11), calidad: 40 } }));
  chequear('FA-02 calidad baja → 422 CALIDAD_INSUFICIENTE', r.estado === 422 && r.json.codigo === 'CALIDAD_INSUFICIENTE', JSON.stringify(r.json));

  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '123', correo: `d${sufijo}@correo.com` }));
  chequear('FA-06 teléfono inválido → 422 con campo', r.estado === 422 && !!r.json.campos?.telefono, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '644' + sufijo + '4', correo: 'no-es-correo' }));
  chequear('FA-06 correo inválido → 422 con campo', r.estado === 422 && !!r.json.campos?.correo, JSON.stringify(r.json));

  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '644' + sufijo + '5', correo: `e${sufijo}@correo.com`, huella: undefined }));
  chequear('FA-08 sin huella y sin motivo → 422', r.estado === 422 && r.json.codigo === 'MOTIVO_REQUERIDO', JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '644' + sufijo + '5', correo: `e${sufijo}@correo.com`, huella: undefined, observacionesAcceso: 'Sin dedos aptos para lector' }));
  chequear('FA-08 sin huella con motivo → 201', r.estado === 201 && r.json.huellaEnrolada === false, JSON.stringify(r.json));

  r = await llamar('GET', '/api/v1/clientes?q=' + encodeURIComponent('López'));
  chequear('SF-01 búsqueda por nombre devuelve ≥ 2', r.estado === 200 && r.json.length >= 2, JSON.stringify(r.json));
  r = await llamar('GET', '/api/v1/clientes?estatus=ACTIVO');
  chequear('SF-01 filtro por estatus', r.estado === 200 && Array.isArray(r.json));

  console.log(`\nResultado: ${ok} correctas, ${fallos} fallidas`);
  // Se marca el código de salida y se deja terminar el proceso solo (sin process.exit()):
  // en Windows, salir de golpe con conexiones fetch aún abiertas provoca un fallo de libuv.
  process.exitCode = fallos ? 1 : 0;
})();
