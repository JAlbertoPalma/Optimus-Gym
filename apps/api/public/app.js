// OptimusGym · Demo CU-02 Administrar Clientes · interfaz de una sola página (SPA).
// Sin framework ni proceso de build. Navegación por "rutas de hash":
//   #/                      → lista y búsqueda (SF-01)
//   #/nuevo                 → registrar cliente (FB-01 y flujos alternos)
//   #/cliente/OG-00001      → ficha + ventanas para editar (SF-02), enrolar/reenrolar
//                             huella (SF-03) y dar de baja/reactivar (SF-04)
//
// REGLA DE SEGURIDAD: TODO dato que llega de la API se escapa con esc() antes de
// insertarse en el HTML, para evitar inyección (XSS) si un dato trae < > " etc.

const app = document.querySelector('#app');
const API = '/api/v1/clientes';

// Escapa texto para insertarlo con seguridad dentro del HTML.
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Llama a la API y devuelve { ok, estado, json } sin lanzar excepción.
async function api(metodo, ruta, cuerpo) {
  const r = await fetch(ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  let json = {};
  try { json = await r.json(); } catch { /* respuesta sin cuerpo */ }
  return { ok: r.ok, estado: r.status, json };
}

// ----- Huella simulada (se reemplazará por el SDK del lector) -----
let ultimaHuella = null; // última plantilla "buena" generada, para probar la opción "repetir"
function generarPlantilla() {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes); // bytes aleatorios → distinta huella cada vez
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
// Arma el objeto huella según la opción elegida. Devuelve undefined para "sin-huella".
function construirHuella(opcion, dedo) {
  if (opcion === 'buena') return { dedo, plantillaBase64: (ultimaHuella = generarPlantilla()), calidad: 88 };
  if (opcion === 'mala') return { dedo, plantillaBase64: generarPlantilla(), calidad: 40 };
  if (opcion === 'repetir') return { dedo, plantillaBase64: ultimaHuella || generarPlantilla(), calidad: 88 };
  return undefined; // sin-huella
}

// ----- Mensajes y errores por campo (comunes a todas las pantallas/modales) -----
function limpiarMensajes(scope) {
  scope.querySelectorAll('.error-campo').forEach((e) => (e.textContent = ''));
  const m = scope.querySelector('.mensaje');
  if (m) { m.className = 'mensaje'; m.textContent = ''; }
}
// Pinta la respuesta de la API: errores junto a su campo y un mensaje de negocio general.
function mostrarRespuesta(scope, ok, json) {
  limpiarMensajes(scope);
  const m = scope.querySelector('.mensaje');
  if (ok) { if (m) { m.className = 'mensaje mensaje-exito visible'; m.textContent = '✔ ' + esc(json.mensaje || 'Operación realizada'); } return; }
  const sinCampo = [];
  if (json.campos) {
    for (const [campo, msg] of Object.entries(json.campos)) {
      const el = scope.querySelector(`[data-error="${CSS.escape(campo)}"]`);
      if (el) el.textContent = msg; else sinCampo.push(msg);
    }
  }
  if (m) {
    m.className = 'mensaje mensaje-error visible';
    m.textContent = '✘ ' + esc(json.mensaje || 'Ocurrió un error') + (sinCampo.length ? ' (' + sinCampo.join('; ') + ')' : '');
  }
}
let mensajePendiente = null; // mensaje de éxito a mostrar al recargar la ficha

// ----- Ventanas modales -----
function cerrarModal() { document.querySelector('.fondo-modal')?.remove(); }
function abrirModal(titulo, contenidoHtml) {
  cerrarModal();
  const fondo = document.createElement('div');
  fondo.className = 'fondo-modal';
  fondo.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <div class="modal-encabezado"><h2>${esc(titulo)}</h2><button class="cerrar" type="button" aria-label="Cerrar">×</button></div>
      ${contenidoHtml}
      <div class="mensaje"></div>
    </div>`;
  document.body.appendChild(fondo);
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrarModal(); });
  fondo.querySelector('.cerrar').addEventListener('click', cerrarModal);
  return fondo.querySelector('.modal');
}

// Fila reutilizable de "captura de huella simulada" (SF-03). Devuelve el <div>.
function campoCapturaHuella(incluirSinHuella) {
  return `
    <div class="fila-dos-campos">
      <div>
        <label>Dedo (1–10)</label>
        <select data-huella-dedo>${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select>
      </div>
      <div>
        <label>Captura simulada</label>
        <select data-huella-opcion>
          <option value="buena">Captura buena (calidad 88)</option>
          <option value="mala">Captura mala (calidad 40)</option>
          <option value="repetir">Repetir última huella (duplicada)</option>
          ${incluirSinHuella ? '<option value="sin-huella">Sin huella</option>' : ''}
        </select>
      </div>
    </div>`;
}

// =============================== PANTALLA: LISTA (SF-01) ===============================
function pantallaLista() {
  app.innerHTML = `
    <section>
      <h2>Clientes</h2>
      <div class="barra-filtros">
        <div><label>Buscar</label><input id="q" placeholder="Nombre, código, teléfono o correo…" autocomplete="off"></div>
        <div>
          <label>Estatus</label>
          <select id="estatus">
            <option value="">Todos</option>
            <option value="ACTIVO">Activos</option>
            <option value="INACTIVO">Inactivos</option>
          </select>
        </div>
        <a class="boton-enlace" href="#/nuevo">+ Registrar cliente</a>
      </div>
      <table>
        <thead><tr><th>Código</th><th>Nombre</th><th>Teléfono</th><th>Huella</th><th>Estatus</th></tr></thead>
        <tbody id="filas"></tbody>
      </table>
      <div id="vacio" class="vacio" style="display:none">Sin resultados.</div>
    </section>`;

  const q = app.querySelector('#q');
  const estatus = app.querySelector('#estatus');
  async function cargar() {
    const params = new URLSearchParams();
    if (q.value.trim()) params.set('q', q.value.trim());
    if (estatus.value) params.set('estatus', estatus.value);
    const { json } = await api('GET', API + '?' + params.toString());
    const filas = app.querySelector('#filas');
    const vacio = app.querySelector('#vacio');
    const lista = Array.isArray(json) ? json : [];
    if (!lista.length) { filas.innerHTML = ''; vacio.style.display = 'block'; return; }
    vacio.style.display = 'none';
    filas.innerHTML = lista.map((c) => {
      const nombre = `${c.nombres || ''} ${c.apellidoPaterno || ''} ${c.apellidoMaterno || ''}`.trim();
      const clase = c.estatus === 'ACTIVO' ? 'activo' : 'inactivo';
      return `<tr>
        <td>${esc(c.codigo)}</td>
        <td>${esc(nombre)}</td>
        <td>${esc(c.telefono)}</td>
        <td>${c.huellaEnrolada ? '✔' : '—'}</td>
        <td><span class="etiqueta-estatus ${clase}">${esc(c.estatus)}</span></td>
      </tr>`;
    }).join('');
    // Al hacer clic en una fila se abre la ficha. Se usa el código del dato (no del HTML).
    filas.querySelectorAll('tr').forEach((tr, i) => tr.addEventListener('click', () => { location.hash = '#/cliente/' + encodeURIComponent(lista[i].codigo); }));
  }
  q.addEventListener('input', cargar);    // búsqueda en tiempo real
  estatus.addEventListener('change', cargar);
  cargar();
}

// =============================== PANTALLA: REGISTRAR (FB-01) ===============================
function pantallaNuevo() {
  app.innerHTML = `
    <section>
      <h2>Registrar cliente</h2>
      <form id="form-nuevo" novalidate>
        <div class="fila-dos-campos">
          <div><label>Nombres</label><input name="nombres" data-error-for><div class="error-campo" data-error="nombres"></div></div>
          <div><label>Apellido paterno</label><input name="apellidoPaterno"><div class="error-campo" data-error="apellidoPaterno"></div></div>
        </div>
        <div class="fila-dos-campos">
          <div><label>Apellido materno</label><input name="apellidoMaterno"><div class="error-campo" data-error="apellidoMaterno"></div></div>
          <div><label>Fecha de nacimiento</label><input type="date" name="fechaNacimiento"><div class="error-campo" data-error="fechaNacimiento"></div></div>
        </div>
        <div class="fila-dos-campos">
          <div><label>Sexo</label><select name="sexo"><option value="F">F</option><option value="M">M</option><option value="O">Otro</option></select></div>
          <div><label>Teléfono (10 dígitos)</label><input name="telefono"><div class="error-campo" data-error="telefono"></div></div>
        </div>
        <label>Correo</label><input name="correo"><div class="error-campo" data-error="correo"></div>
        <h3>Contacto de emergencia</h3>
        <div class="fila-dos-campos">
          <div><label>Nombre</label><input name="ceNombre"><div class="error-campo" data-error="contactoEmergencia.nombre"></div></div>
          <div><label>Teléfono</label><input name="ceTelefono"><div class="error-campo" data-error="contactoEmergencia.telefono"></div></div>
        </div>
        <label>Parentesco (opcional)</label><input name="ceParentesco">
        <h3>Huella (simulada)</h3>
        ${campoCapturaHuella(true)}
        <label>Observaciones de acceso (obligatorio si no se enrola huella)</label>
        <textarea name="observacionesAcceso"></textarea>
        <div class="error-campo" data-error="observacionesAcceso"></div>
        <div class="acciones">
          <button type="submit">Registrar</button>
          <a class="boton-enlace" href="#/">Cancelar</a>
        </div>
        <div class="mensaje"></div>
      </form>`;

  const form = app.querySelector('#form-nuevo');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = form.querySelector('button[type="submit"]');
    const v = (n) => form.querySelector(`[name="${n}"]`).value.trim();
    const opcion = form.querySelector('[data-huella-opcion]').value;
    const dedo = Number(form.querySelector('[data-huella-dedo]').value);
    const cuerpo = {
      nombres: v('nombres'), apellidoPaterno: v('apellidoPaterno'), apellidoMaterno: v('apellidoMaterno') || undefined,
      fechaNacimiento: v('fechaNacimiento'), sexo: v('sexo'), telefono: v('telefono'), correo: v('correo'),
      contactoEmergencia: { nombre: v('ceNombre'), telefono: v('ceTelefono'), parentesco: v('ceParentesco') || undefined },
      observacionesAcceso: v('observacionesAcceso') || undefined,
      huella: construirHuella(opcion, dedo),
    };
    boton.disabled = true;
    const r = await api('POST', API, cuerpo);
    boton.disabled = false;
    mostrarRespuesta(form, r.ok, r.json);
    if (r.ok) { mensajePendiente = 'Cliente ' + r.json.codigo + ' registrado correctamente'; location.hash = '#/cliente/' + encodeURIComponent(r.json.codigo); }
  });
}

// =============================== PANTALLA: FICHA ===============================
async function pantallaFicha(codigo) {
  app.innerHTML = '<section><p class="vacio">Cargando…</p></section>';
  const { ok, estado, json } = await api('GET', API + '/' + encodeURIComponent(codigo));
  if (!ok) {
    app.innerHTML = `<section><h2>Cliente</h2><div class="mensaje mensaje-error visible">✘ ${esc(json.mensaje || ('No se pudo cargar (' + estado + ')'))}</div><div class="acciones"><a class="boton-enlace" href="#/">Volver</a></div></section>`;
    return;
  }
  const f = json;
  const activo = f.estatus === 'ACTIVO';
  const nombre = `${f.nombres || ''} ${f.apellidoPaterno || ''} ${f.apellidoMaterno || ''}`.trim();
  const fila = (etiqueta, valor) => `<div class="dato"><span>${esc(etiqueta)}:</span> ${esc(valor || '—')}</div>`;
  const huellasHtml = (f.huellas || []).length
    ? `<table><thead><tr><th>Dedo</th><th>Calidad</th><th>Enrolada</th></tr></thead><tbody>${f.huellas.map((h) => `<tr><td>${esc(h.dedo)}</td><td>${esc(h.calidad)}</td><td>${esc(String(h.fechaEnrolamiento || '').slice(0, 10))}</td></tr>`).join('')}</tbody></table>`
    : '<p class="vacio">Sin huellas activas (pendiente de enrolamiento).</p>';

  app.innerHTML = `
    <section>
      <div class="modal-encabezado">
        <h2>${esc(nombre)} <span class="etiqueta-estatus ${activo ? 'activo' : 'inactivo'}">${esc(f.estatus)}</span></h2>
        <a class="boton-enlace" href="#/">Volver</a>
      </div>
      <small>${esc(f.codigo)}</small>
      <h3>Datos</h3>
      ${fila('Fecha de nacimiento', String(f.fechaNacimiento || '').slice(0, 10))}
      ${fila('Sexo', f.sexo)}
      ${fila('Teléfono', f.telefono)}
      ${fila('Correo', f.correo)}
      ${fila('Dirección', f.direccion)}
      ${fila('Observaciones de acceso', f.observacionesAcceso)}
      ${!activo ? fila('Motivo de baja', f.motivoBaja) : ''}
      <h3>Contacto de emergencia</h3>
      ${f.contactoEmergencia ? fila('Nombre', f.contactoEmergencia.nombre) + fila('Teléfono', f.contactoEmergencia.telefono) + fila('Parentesco', f.contactoEmergencia.parentesco) : '<p class="vacio">Sin contacto.</p>'}
      <h3>Huellas activas</h3>
      ${huellasHtml}
      <div class="acciones">
        ${activo ? '<button id="btn-editar" class="secundario" type="button">Editar datos</button>' : ''}
        ${activo ? '<button id="btn-huella" class="secundario" type="button">Enrolar / reenrolar huella</button>' : ''}
        ${activo ? '<button id="btn-baja" class="peligro" type="button">Dar de baja</button>' : '<button id="btn-reactivar" type="button">Reactivar</button>'}
      </div>
      <div class="mensaje"></div>
    </section>`;

  if (mensajePendiente) { mostrarRespuesta(app.querySelector('section'), true, { mensaje: mensajePendiente }); mensajePendiente = null; }

  app.querySelector('#btn-editar')?.addEventListener('click', () => modalEditar(f));
  app.querySelector('#btn-huella')?.addEventListener('click', () => modalHuella(f.codigo));
  app.querySelector('#btn-baja')?.addEventListener('click', () => modalBaja(f.codigo));
  app.querySelector('#btn-reactivar')?.addEventListener('click', async () => {
    const r = await api('POST', API + '/' + encodeURIComponent(f.codigo) + '/reactivar', {});
    if (r.ok) { mensajePendiente = r.json.mensaje; pantallaFicha(codigo); }
    else mostrarRespuesta(app.querySelector('section'), false, r.json);
  });
}

// ----- Modal: editar datos (SF-02) -----
function modalEditar(f) {
  const ce = f.contactoEmergencia || {};
  const modal = abrirModal('Editar datos · ' + f.codigo, `
    <form id="form-editar" novalidate>
      <div class="fila-dos-campos">
        <div><label>Nombres</label><input name="nombres" value="${esc(f.nombres)}"><div class="error-campo" data-error="nombres"></div></div>
        <div><label>Apellido paterno</label><input name="apellidoPaterno" value="${esc(f.apellidoPaterno)}"><div class="error-campo" data-error="apellidoPaterno"></div></div>
      </div>
      <div class="fila-dos-campos">
        <div><label>Apellido materno</label><input name="apellidoMaterno" value="${esc(f.apellidoMaterno)}"><div class="error-campo" data-error="apellidoMaterno"></div></div>
        <div><label>Fecha de nacimiento</label><input type="date" name="fechaNacimiento" value="${esc(String(f.fechaNacimiento || '').slice(0, 10))}"><div class="error-campo" data-error="fechaNacimiento"></div></div>
      </div>
      <div class="fila-dos-campos">
        <div><label>Teléfono</label><input name="telefono" value="${esc(f.telefono)}"><div class="error-campo" data-error="telefono"></div></div>
        <div><label>Correo</label><input name="correo" value="${esc(f.correo)}"><div class="error-campo" data-error="correo"></div></div>
      </div>
      <label>Dirección</label><input name="direccion" value="${esc(f.direccion)}"><div class="error-campo" data-error="direccion"></div>
      <label>Observaciones de acceso</label><textarea name="observacionesAcceso">${esc(f.observacionesAcceso)}</textarea><div class="error-campo" data-error="observacionesAcceso"></div>
      <h3>Contacto de emergencia</h3>
      <div class="fila-dos-campos">
        <div><label>Nombre</label><input name="ceNombre" value="${esc(ce.nombre)}"><div class="error-campo" data-error="contactoEmergencia.nombre"></div></div>
        <div><label>Teléfono</label><input name="ceTelefono" value="${esc(ce.telefono)}"><div class="error-campo" data-error="contactoEmergencia.telefono"></div></div>
      </div>
      <label>Parentesco</label><input name="ceParentesco" value="${esc(ce.parentesco)}">
      <div class="acciones"><button type="submit">Guardar cambios</button><button type="button" class="secundario" data-cerrar>Cancelar</button></div>
    </form>`);
  modal.querySelector('[data-cerrar]').addEventListener('click', cerrarModal);
  modal.querySelector('#form-editar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const boton = form.querySelector('button[type="submit"]');
    const v = (n) => form.querySelector(`[name="${n}"]`).value;
    const cuerpo = {
      nombres: v('nombres').trim(), apellidoPaterno: v('apellidoPaterno').trim(), apellidoMaterno: v('apellidoMaterno').trim(),
      fechaNacimiento: v('fechaNacimiento'), telefono: v('telefono').trim(), correo: v('correo').trim(),
      direccion: v('direccion').trim(), observacionesAcceso: v('observacionesAcceso').trim(),
      contactoEmergencia: { nombre: v('ceNombre').trim(), telefono: v('ceTelefono').trim(), parentesco: v('ceParentesco').trim() },
    };
    boton.disabled = true;
    const r = await api('PATCH', API + '/' + encodeURIComponent(f.codigo), cuerpo);
    boton.disabled = false;
    if (r.ok) { cerrarModal(); mensajePendiente = r.json.mensaje; pantallaFicha(f.codigo); }
    else mostrarRespuesta(modal, false, r.json);
  });
}

// ----- Modal: enrolar / reenrolar huella (SF-03, FA-04) -----
function modalHuella(codigo) {
  const modal = abrirModal('Enrolar / reenrolar huella · ' + codigo, `
    <form id="form-huella" novalidate>
      ${campoCapturaHuella(false)}
      <small>Si el dedo ya tiene huella, se reemplaza (reenrolamiento). "Repetir" reutiliza la última captura para probar el bloqueo por duplicado.</small>
      <div class="acciones"><button type="submit">Capturar y guardar</button><button type="button" class="secundario" data-cerrar>Cancelar</button></div>
    </form>`);
  modal.querySelector('[data-cerrar]').addEventListener('click', cerrarModal);
  modal.querySelector('#form-huella').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const boton = form.querySelector('button[type="submit"]');
    const opcion = form.querySelector('[data-huella-opcion]').value;
    const dedo = Number(form.querySelector('[data-huella-dedo]').value);
    boton.disabled = true;
    const r = await api('POST', API + '/' + encodeURIComponent(codigo) + '/huella', construirHuella(opcion, dedo));
    boton.disabled = false;
    if (r.ok) { cerrarModal(); mensajePendiente = r.json.mensaje; pantallaFicha(codigo); }
    else mostrarRespuesta(modal, false, r.json);
  });
}

// ----- Modal: dar de baja (SF-04) -----
function modalBaja(codigo) {
  const modal = abrirModal('Dar de baja · ' + codigo, `
    <form id="form-baja" novalidate>
      <label>Motivo de baja (obligatorio)</label>
      <textarea name="motivo"></textarea><div class="error-campo" data-error="motivo"></div>
      <div class="acciones"><button type="submit" class="peligro">Confirmar baja</button><button type="button" class="secundario" data-cerrar>Cancelar</button></div>
    </form>`);
  modal.querySelector('[data-cerrar]').addEventListener('click', cerrarModal);
  modal.querySelector('#form-baja').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const boton = form.querySelector('button[type="submit"]');
    boton.disabled = true;
    const r = await api('POST', API + '/' + encodeURIComponent(codigo) + '/baja', { motivo: form.querySelector('[name="motivo"]').value.trim() });
    boton.disabled = false;
    if (r.ok) { cerrarModal(); mensajePendiente = r.json.mensaje; pantallaFicha(codigo); }
    else mostrarRespuesta(modal, false, r.json);
  });
}

// =============================== RUTEADOR ===============================
function router() {
  cerrarModal();
  const hash = location.hash || '#/';
  if (hash.startsWith('#/nuevo')) return pantallaNuevo();
  if (hash.startsWith('#/cliente/')) return pantallaFicha(decodeURIComponent(hash.slice('#/cliente/'.length)));
  return pantallaLista();
}
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);
