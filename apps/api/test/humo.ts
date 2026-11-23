// Pruebas de humo del ALTA de cliente (CU-02: FB-01, FA-01, FA-02, FA-05, FA-06, FA-08, SF-01 y O-04).
// Se ejecutan con la API encendida:  npm run api:probar
// Son RE-EJECUTABLES: cada corrida usa teléfono, correo y huella ALEATORIOS.
import 'dotenv/config';
import { randomBytes } from 'crypto';
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
// Antes la huella era siempre la misma (calculada con una fórmula fija), así que en la
// segunda corrida el alta FB-01 chocaba con la huella guardada en la primera.
const sufijo = Array.from(randomBytes(6), (b) => b % 10).join('');     // 6 dígitos aleatorios
const huellaPrincipal = randomBytes(64).toString('base64');             // la del alta FB-01; FA-05 la repite a propósito
const huellaNueva = () => randomBytes(64).toString('base64');           // una distinta en cada llamada
const alta = (o: any = {}) => ({
  nombres: 'Ana', apellidoPaterno: 'López', apellidoMaterno: 'Ruiz', fechaNacimiento: '1998-05-14', sexo: 'F',
  telefono: '644' + sufijo + '1', correo: `ana${sufijo}@correo.com`,
  contactoEmergencia: { nombre: 'Luis López', telefono: '6441112233', parentesco: 'Padre' },
  huella: { dedo: 2, plantillaBase64: huellaPrincipal, calidad: 88 }, ...o,
});

(async () => {
  console.log('Pruebas de humo · CU-02 registrarCliente');
  let r = await llamar('GET', '/health');
  chequear('GET /health responde ok', r.estado === 200 && r.json.estado === 'ok');

  r = await llamar('POST', '/api/v1/clientes', alta());
  chequear('FB-01 alta con huella → 201 y código OG-', r.estado === 201 && /^OG-\d{5}$/.test(r.json.codigo), JSON.stringify(r.json));

  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '644' + sufijo + '9', huella: { dedo: 3, plantillaBase64: huellaNueva(), calidad: 90 } }));
  chequear('FA-01 correo repetido → 409 DUPLICADO', r.estado === 409 && r.json.codigo === 'DUPLICADO', JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/clientes', alta({ correo: `otro${sufijo}@correo.com`, huella: { dedo: 3, plantillaBase64: huellaNueva(), calidad: 90 } }));
  chequear('FA-01 teléfono repetido → 409 DUPLICADO', r.estado === 409 && r.json.codigo === 'DUPLICADO', JSON.stringify(r.json));

  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '644' + sufijo + '2', correo: `b${sufijo}@correo.com` }));
  chequear('FA-05 huella duplicada → 409 HUELLA_DUPLICADA', r.estado === 409 && r.json.codigo === 'HUELLA_DUPLICADA', JSON.stringify(r.json));

  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '644' + sufijo + '3', correo: `c${sufijo}@correo.com`, huella: { dedo: 2, plantillaBase64: huellaNueva(), calidad: 40 } }));
  chequear('FA-02 calidad baja → 422 CALIDAD_INSUFICIENTE', r.estado === 422 && r.json.codigo === 'CALIDAD_INSUFICIENTE', JSON.stringify(r.json));

  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '123', correo: `d${sufijo}@correo.com` }));
  chequear('FA-06 teléfono inválido → 422 con campo', r.estado === 422 && !!r.json.campos?.telefono, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '644' + sufijo + '4', correo: 'no-es-correo' }));
  chequear('FA-06 correo inválido → 422 con campo', r.estado === 422 && !!r.json.campos?.correo, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '644' + sufijo + '6', correo: `f${sufijo}@correo.com`, fechaNacimiento: '2001-02-30' }));
  chequear('FA-06 fecha inexistente (30-feb) → 422 con campo', r.estado === 422 && !!r.json.campos?.fechaNacimiento, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '644' + sufijo + '7', correo: `g${sufijo}@correo.com`, huella: { dedo: 2, plantillaBase64: 'A'.repeat(9000), calidad: 90 } }));
  chequear('FA-06 plantilla demasiado grande → 422 con campo', r.estado === 422 && !!r.json.campos?.['huella.plantillaBase64'], JSON.stringify(r.json));

  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '644' + sufijo + '5', correo: `e${sufijo}@correo.com`, huella: undefined }));
  chequear('FA-08 sin huella y sin motivo → 422', r.estado === 422 && r.json.codigo === 'MOTIVO_REQUERIDO', JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/clientes', alta({ telefono: '644' + sufijo + '5', correo: `e${sufijo}@correo.com`, huella: undefined, observacionesAcceso: 'Sin dedos aptos para lector' }));
  chequear('FA-08 sin huella con motivo → 201', r.estado === 201 && r.json.huellaEnrolada === false, JSON.stringify(r.json));

  r = await llamar('GET', '/api/v1/clientes?q=' + encodeURIComponent('López'));
  chequear('SF-01 búsqueda por nombre devuelve ≥ 2', r.estado === 200 && r.json.length >= 2, JSON.stringify(r.json));
  r = await llamar('GET', '/api/v1/clientes?estatus=ACTIVO');
  chequear('SF-01 filtro por estatus', r.estado === 200 && Array.isArray(r.json));

  // O-04 (CP-27): la búsqueda por nombre no distingue acentos ni mayúsculas.
  // Se da de alta un cliente con acentos y un apellido único por corrida (los dígitos del sufijo pasados a letras),
  // para no depender de los muchos "Ana López" que dejan las corridas anteriores.
  const letras = [...sufijo].map((d) => 'abcdefghij'[Number(d)]).join('');
  const altaAcentos = await llamar('POST', '/api/v1/clientes', alta({
    nombres: 'Íñigo', apellidoPaterno: 'Núñez', apellidoMaterno: 'Ruíz' + letras,
    telefono: '644' + sufijo + '8', correo: `h${sufijo}@correo.com`,
    huella: { dedo: 4, plantillaBase64: huellaNueva(), calidad: 90 } }));
  const codigoAcentos = altaAcentos.json.codigo;
  const contiene = (lista: any) => Array.isArray(lista) && lista.some((c: any) => c.codigo === codigoAcentos);
  r = await llamar('GET', '/api/v1/clientes?q=' + encodeURIComponent('inigo nunez ruiz' + letras));
  chequear('O-04 buscar sin acentos encuentra al cliente con acentos', !!codigoAcentos && r.estado === 200 && contiene(r.json),
    JSON.stringify({ alta: altaAcentos.json, busqueda: r.json }));
  r = await llamar('GET', '/api/v1/clientes?q=' + encodeURIComponent('iÑIgO NúñEZ rUIZ' + letras.toUpperCase()));
  chequear('O-04 buscar con mayúsculas y minúsculas mezcladas lo encuentra', !!codigoAcentos && r.estado === 200 && contiene(r.json),
    JSON.stringify(r.json));
  r = await llamar('GET', '/api/v1/clientes?q=' + encodeURIComponent('Zyxwq Qwxyz ' + sufijo));
  chequear('O-04 búsqueda sin coincidencias devuelve 0', r.estado === 200 && Array.isArray(r.json) && r.json.length === 0,
    JSON.stringify(r.json));

  console.log(`\nResultado: ${ok} correctas, ${fallos} fallidas`);
  // Se marca el código de salida y se deja terminar el proceso solo (sin process.exit()):
  // en Windows, salir de golpe con conexiones fetch aún abiertas provoca un fallo de libuv.
  process.exitCode = fallos ? 1 : 0;
})();
