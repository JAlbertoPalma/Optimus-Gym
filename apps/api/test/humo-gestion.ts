// Pruebas de humo de la GESTIÓN del cliente (CU-02: SF-02 editar, SF-03 huella,
// SF-04 baja/reactivar y la ficha). Complementan a test/humo.ts (que cubre el alta).
//
// Se ejecutan con la API encendida:  npm run api:probar:gestion
// Son RE-EJECUTABLES: cada corrida usa correos/teléfonos y huellas ALEATORIOS
// (crypto.randomBytes), así no chocan con datos de corridas anteriores.
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

// Datos aleatorios para que las pruebas se puedan repetir sin reiniciar la BD
const digitos = (n: number) => Array.from(randomBytes(n), (b) => b % 10).join('');
const telefono = () => '55' + digitos(8);                 // 10 dígitos
const correo = () => `g${digitos(9)}@correo.com`;
const huellaB64 = () => randomBytes(64).toString('base64'); // plantilla simulada aleatoria

// Crea un cliente de prueba y devuelve su código + los datos usados.
async function crearCliente(extra: any = {}) {
  const cuerpo = {
    nombres: 'Gestión', apellidoPaterno: 'Prueba', apellidoMaterno: 'QA',
    fechaNacimiento: '1995-03-20', sexo: 'M', telefono: telefono(), correo: correo(),
    contactoEmergencia: { nombre: 'Contacto Uno', telefono: telefono(), parentesco: 'Hermano' },
    ...extra,
  };
  const r = await llamar('POST', '/api/v1/clientes', cuerpo);
  if (r.estado !== 201) throw new Error('No se pudo crear cliente de prueba: ' + JSON.stringify(r.json));
  return { codigo: r.json.codigo as string, ...cuerpo };
}

(async () => {
  console.log('Pruebas de humo · CU-02 gestión (ficha, editar, huella, baja/reactivar)');

  // ---- Ficha (consulta) ----
  const huellaA = huellaB64();
  const a = await crearCliente({ huella: { dedo: 2, plantillaBase64: huellaA, calidad: 90 } });
  let r = await llamar('GET', '/api/v1/clientes/' + a.codigo);
  chequear('Ficha → 200 con código y contacto', r.estado === 200 && r.json.codigo === a.codigo && !!r.json.contactoEmergencia, JSON.stringify(r.json));
  chequear('Ficha lista huellas activas (1)', Array.isArray(r.json.huellas) && r.json.huellas.length === 1 && r.json.huellas[0].dedo === 2, JSON.stringify(r.json.huellas));
  chequear('Ficha NUNCA expone la plantilla', JSON.stringify(r.json).toLowerCase().indexOf('plantilla') === -1, JSON.stringify(r.json));
  r = await llamar('GET', '/api/v1/clientes/OG-00000');
  chequear('Ficha de código inexistente → 404 NO_ENCONTRADO', r.estado === 404 && r.json.codigo === 'NO_ENCONTRADO', JSON.stringify(r.json));

  // ---- Editar datos (SF-02) ----
  r = await llamar('PATCH', '/api/v1/clientes/' + a.codigo, { direccion: 'Calle Falsa 123' });
  chequear('SF-02 editar dirección → 200', r.estado === 200 && r.json.camposActualizados?.includes('direccion'), JSON.stringify(r.json));
  r = await llamar('PATCH', '/api/v1/clientes/' + a.codigo, { direccion: 'Calle Falsa 123' });
  chequear('SF-02 sin cambios → 422 SIN_CAMBIOS', r.estado === 422 && r.json.codigo === 'SIN_CAMBIOS', JSON.stringify(r.json));
  r = await llamar('PATCH', '/api/v1/clientes/' + a.codigo, { contactoEmergencia: { telefono: telefono() } });
  chequear('SF-02 cambia tel. contacto → 200 (audita contactoEmergencia.telefono)', r.estado === 200 && r.json.camposActualizados?.includes('contactoEmergencia.telefono'), JSON.stringify(r.json));

  // Duplicado contra OTRA persona
  const b = await crearCliente({ huella: { dedo: 2, plantillaBase64: huellaB64(), calidad: 85 } });
  r = await llamar('PATCH', '/api/v1/clientes/' + a.codigo, { correo: b.correo });
  chequear('SF-02 correo de otra persona → 409 DUPLICADO', r.estado === 409 && r.json.codigo === 'DUPLICADO', JSON.stringify(r.json));
  r = await llamar('PATCH', '/api/v1/clientes/' + a.codigo, { telefono: b.telefono });
  chequear('SF-02 teléfono de otra persona → 409 DUPLICADO', r.estado === 409 && r.json.codigo === 'DUPLICADO', JSON.stringify(r.json));

  // ---- Enrolar / reenrolar huella (SF-03, FA-04) ----
  // Cliente dado de alta SIN huella (con motivo) para enrolarla después (FA-04)
  const s = await crearCliente({ observacionesAcceso: 'Enrolamiento pendiente' });
  r = await llamar('GET', '/api/v1/clientes/' + s.codigo);
  chequear('FA-04 alta sin huella → ficha sin huellas', r.estado === 200 && r.json.huellas.length === 0, JSON.stringify(r.json.huellas));
  r = await llamar('POST', '/api/v1/clientes/' + s.codigo + '/huella', { dedo: 3, plantillaBase64: huellaB64(), calidad: 88 });
  chequear('SF-03 enrolar primera huella → 201 (reenrolado=false)', r.estado === 201 && r.json.reenrolado === false, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/clientes/' + s.codigo + '/huella', { dedo: 3, plantillaBase64: huellaB64(), calidad: 92 });
  chequear('SF-03 reenrolar mismo dedo → 201 (reenrolado=true)', r.estado === 201 && r.json.reenrolado === true, JSON.stringify(r.json));
  r = await llamar('GET', '/api/v1/clientes/' + s.codigo);
  chequear('SF-03 tras reenrolar sigue habiendo 1 huella activa', r.estado === 200 && r.json.huellas.length === 1 && r.json.huellas[0].calidad === 92, JSON.stringify(r.json.huellas));
  r = await llamar('POST', '/api/v1/clientes/' + s.codigo + '/huella', { dedo: 4, plantillaBase64: huellaB64(), calidad: 40 });
  chequear('SF-03 calidad baja → 422 CALIDAD_INSUFICIENTE', r.estado === 422 && r.json.codigo === 'CALIDAD_INSUFICIENTE', JSON.stringify(r.json));
  // Huella duplicada: intentar enrolar en "s" la misma plantilla activa de "a"
  r = await llamar('POST', '/api/v1/clientes/' + s.codigo + '/huella', { dedo: 5, plantillaBase64: huellaA, calidad: 90 });
  chequear('SF-03/FA-05 huella de otra persona → 409 HUELLA_DUPLICADA', r.estado === 409 && r.json.codigo === 'HUELLA_DUPLICADA', JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/clientes/OG-00000/huella', { dedo: 2, plantillaBase64: huellaB64(), calidad: 90 });
  chequear('SF-03 enrolar en código inexistente → 404', r.estado === 404 && r.json.codigo === 'NO_ENCONTRADO', JSON.stringify(r.json));

  // ---- FA-08 por edición: sin huella activa no se puede vaciar el motivo de acceso ----
  const sinHuella = await crearCliente({ observacionesAcceso: 'Motivo original' });
  r = await llamar('PATCH', '/api/v1/clientes/' + sinHuella.codigo, { observacionesAcceso: '' });
  chequear('SF-02 vaciar motivo sin huella → 422 MOTIVO_REQUERIDO', r.estado === 422 && r.json.codigo === 'MOTIVO_REQUERIDO', JSON.stringify(r.json));

  // ---- Baja / reactivar (SF-04) ----
  r = await llamar('POST', '/api/v1/clientes/' + a.codigo + '/baja', {});
  chequear('SF-04 baja sin motivo → 422 con campo motivo', r.estado === 422 && !!r.json.campos?.motivo, JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/clientes/' + a.codigo + '/baja', { motivo: 'Dejó de asistir' });
  chequear('SF-04 baja con motivo → 200 INACTIVO', r.estado === 200 && r.json.estatus === 'INACTIVO', JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/clientes/' + a.codigo + '/baja', { motivo: 'Otra vez' });
  chequear('SF-04 baja de cliente ya inactivo → 409 YA_INACTIVO', r.estado === 409 && r.json.codigo === 'YA_INACTIVO', JSON.stringify(r.json));
  r = await llamar('PATCH', '/api/v1/clientes/' + a.codigo, { direccion: 'Nueva dir' });
  chequear('SF-02 editar cliente inactivo → 409 CLIENTE_INACTIVO', r.estado === 409 && r.json.codigo === 'CLIENTE_INACTIVO', JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/clientes/' + a.codigo + '/huella', { dedo: 6, plantillaBase64: huellaB64(), calidad: 90 });
  chequear('SF-03 enrolar en cliente inactivo → 409 CLIENTE_INACTIVO', r.estado === 409 && r.json.codigo === 'CLIENTE_INACTIVO', JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/clientes/' + a.codigo + '/reactivar', {});
  chequear('SF-04 reactivar → 200 ACTIVO', r.estado === 200 && r.json.estatus === 'ACTIVO', JSON.stringify(r.json));
  r = await llamar('POST', '/api/v1/clientes/' + a.codigo + '/reactivar', {});
  chequear('SF-04 reactivar ya activo → 409 YA_ACTIVO', r.estado === 409 && r.json.codigo === 'YA_ACTIVO', JSON.stringify(r.json));
  r = await llamar('GET', '/api/v1/clientes/' + a.codigo);
  chequear('Tras reactivar, la baja quedó limpia (sin motivoBaja)', r.estado === 200 && r.json.estatus === 'ACTIVO' && !r.json.motivoBaja, JSON.stringify(r.json));

  console.log(`\nResultado: ${ok} correctas, ${fallos} fallidas`);
  // Se marca el código de salida y se deja terminar el proceso solo (sin process.exit()):
  // en Windows, salir de golpe con conexiones fetch aún abiertas provoca un fallo de libuv.
  process.exitCode = fallos ? 1 : 0;
})();
