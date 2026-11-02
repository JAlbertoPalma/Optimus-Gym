// Optimus Gym · CU-04 Registrar venta de membresía · interfaz (sin framework ni build).
// El navegador NO calcula lo que se cobra: precio, descuento, total y vigencia los calcula
// la API (POST /ventas/cotizar) y se vuelven a validar al registrar (POST /ventas).
// Aquí solo se calcula el CAMBIO para mostrarlo al instante mientras se teclea el importe;
// el cambio que se guarda y se imprime es el que calcula el servidor.
//
// REGLA DE SEGURIDAD (igual que app.js): todo dato de la API se escapa con esc() antes de ir al HTML.
// Ruta opcional: venta.html?cliente=OG-00001 abre la venta con ese cliente ya seleccionado.

const API = '/api/v1';
const $ = (sel) => document.querySelector(sel);

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Llama a la API y devuelve { ok, estado, json } sin lanzar excepción (estado 0 = sin conexión).
async function api(metodo, ruta, cuerpo) {
  try {
    const r = await fetch(API + ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    let json = {};
    try { json = await r.json(); } catch { /* sin cuerpo */ }
    return { ok: r.ok, estado: r.status, json };
  } catch {
    return { ok: false, estado: 0, json: { codigo: 'SIN_CONEXION', mensaje: 'No se pudo conectar con el servidor' } };
  }
}

const formatoMoneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
const dinero = (n) => formatoMoneda.format(Number(n) || 0);
const centavos = (n) => Math.round(Number(n) * 100);
function fecha(f) { // 'AAAA-MM-DD' → '30 de noviembre de 2026' (en UTC para no recorrer el día)
  if (!f) return '—';
  const [a, m, d] = f.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
const NOMBRE_METODO = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia' };

// ------------------------------------------------------------------ estado de la operación
const estado = {
  planes: [], metodos: [],
  cliente: null,        // respuesta de GET /ventas/clientes/:codigo
  idTipo: null, idPromocion: null,
  cotizacion: null,     // respuesta de POST /ventas/cotizar
  metodo: 'EFECTIVO',
  clave: crypto.randomUUID(), // una por operación: si se reintenta, el servidor no duplica la venta
  procesando: false,
  turnoCotizacion: 0,   // descarta respuestas viejas si el usuario cambia rápido de plan
};

// ------------------------------------------------------------------ mensajes
function aviso(el, tipo, texto) {
  if (!texto) { el.hidden = true; el.textContent = ''; return; }
  el.className = 'aviso aviso-' + tipo;
  el.textContent = texto;
  el.hidden = false;
}
function limpiarErroresCampo() { document.querySelectorAll('.error-campo').forEach((e) => (e.textContent = '')); }
function erroresCampo(campos) {
  const sinLugar = [];
  for (const [campo, msg] of Object.entries(campos || {})) {
    const el = document.querySelector(`[data-error="${CSS.escape(campo)}"]`);
    if (el) el.textContent = msg; else sinLugar.push(msg);
  }
  return sinLugar;
}
function mostrarError(json) {
  limpiarErroresCampo();
  const extra = erroresCampo(json.campos);
  aviso($('#mensaje-cobro'), 'error', '✘ ' + (json.mensaje || 'Ocurrió un error') + (extra.length ? ' (' + extra.join('; ') + ')' : ''));
}

// ------------------------------------------------------------------ cliente
let temporizadorBusqueda;
let resultados = [];

async function buscarClientes() {
  const q = $('#q-cliente').value.trim();
  const lista = $('#resultados-cliente');
  aviso($('#aviso-cliente'), 'info', '');
  if (q.length < 2) { lista.hidden = true; return; }
  // Reutiliza la búsqueda del CU-02 (GET /clientes?q=)
  const r = await api('GET', '/clientes?q=' + encodeURIComponent(q));
  if (q !== $('#q-cliente').value.trim()) return; // llegó tarde: el usuario ya escribió otra cosa
  if (!r.ok) { lista.hidden = true; aviso($('#aviso-cliente'), 'error', r.json.mensaje || 'No se pudo buscar'); return; }
  resultados = (Array.isArray(r.json) ? r.json : []).slice(0, 15);
  if (!resultados.length) { lista.hidden = true; aviso($('#aviso-cliente'), 'error', 'No existe ningún cliente que coincida con "' + q + '".'); return; }
  // Cada fila muestra código y celular: así no se confunden dos clientes con el mismo nombre
  lista.innerHTML = resultados.map((c, i) => {
    const nombre = `${c.nombres || ''} ${c.apellidoPaterno || ''} ${c.apellidoMaterno || ''}`.trim();
    return `<li><button type="button" data-i="${i}"><span>${esc(nombre)} · ${esc(c.telefono)}${c.estatus === 'INACTIVO' ? ' <span class="insignia insignia-alerta">INACTIVO</span>' : ''}</span><span class="codigo">${esc(c.codigo)}</span></button></li>`;
  }).join('');
  lista.hidden = false;
  lista.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => seleccionarCliente(resultados[Number(b.dataset.i)].codigo)));
  // Código exacto → se selecciona solo
  const exacto = resultados.find((c) => c.codigo.toUpperCase() === q.toUpperCase());
  if (exacto) seleccionarCliente(exacto.codigo);
}

async function seleccionarCliente(codigo) {
  $('#resultados-cliente').hidden = true;
  const r = await api('GET', '/ventas/clientes/' + encodeURIComponent(codigo));
  if (!r.ok) { aviso($('#aviso-cliente'), 'error', r.json.mensaje || 'No se pudo cargar el cliente'); return; }
  estado.cliente = r.json;
  aviso($('#mensaje-cobro'), 'error', '');
  pintarCliente();
  cotizar();
}

function pintarCliente() {
  const c = estado.cliente;
  const buscador = $('#buscador-cliente');
  const ficha = $('#cliente-seleccionado');
  const insignia = $('#estado-acceso');
  if (!c) {
    buscador.hidden = false; ficha.hidden = true; ficha.innerHTML = '';
    insignia.className = 'insignia insignia-neutra'; insignia.textContent = 'Selecciona un cliente';
    return;
  }
  const iniciales = c.nombre.split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();
  const fotoSegura = c.foto && /^(\/|https?:\/\/)/.test(c.foto);
  const membresia = c.membresiaVigente
    ? `Membresía vigente: <strong>${esc(c.membresiaVigente.plan)}</strong> hasta ${esc(fecha(c.membresiaVigente.fechaFin))}`
    : c.ultimoFin ? `Membresía vencida el ${esc(fecha(c.ultimoFin))}` : 'Sin membresías anteriores';
  ficha.innerHTML = `
    <div class="ficha-cliente">
      ${fotoSegura ? `<img class="foto" src="${esc(c.foto)}" alt="Fotografía de ${esc(c.nombre)}">` : `<div class="foto" aria-hidden="true">${esc(iniciales)}</div>`}
      <div class="ficha-datos">
        <div class="nombre">${esc(c.nombre)}</div>
        <div class="linea">Cel. ${esc(c.telefono)} · Código ${esc(c.codigo)}</div>
        <div class="linea">${membresia}</div>
      </div>
      <div class="ficha-acciones"><button type="button" class="boton-secundario" id="btn-cambiar-cliente">Cambiar cliente</button></div>
    </div>
    ${c.conducta === 'EN_OBSERVACION' ? '<p class="aviso aviso-info">Cliente en observación. Revisa sus observaciones de acceso antes de cobrar.</p>' : ''}
    ${c.motivoBloqueo ? `<p class="aviso aviso-error">${esc(c.motivoBloqueo)}</p>` : ''}`;
  buscador.hidden = true;
  ficha.hidden = false;
  insignia.className = 'insignia ' + (c.acceso.permitido ? 'insignia-ok' : 'insignia-alerta');
  insignia.textContent = c.acceso.motivo;
  $('#btn-cambiar-cliente').addEventListener('click', () => {
    estado.cliente = null;
    pintarCliente();
    $('#q-cliente').value = '';
    $('#q-cliente').focus();
    cotizar();
  });
}

// ------------------------------------------------------------------ planes
function pintarPlanes() {
  const cont = $('#planes');
  if (!estado.planes.length) {
    cont.innerHTML = '<p class="aviso aviso-error">No hay planes de membresía configurados. Pide al administrador que los registre para poder vender.</p>';
    return;
  }
  cont.innerHTML = estado.planes.map((p) => `
    <div class="plan ${p.idTipo === estado.idTipo ? 'seleccionado' : ''}">
      <span class="plan-nombre">${esc(p.nombre)}</span>
      <span class="plan-duracion">${esc(p.duracionDias)} ${p.duracionDias === 1 ? 'día' : 'días'}</span>
      <span class="plan-precio">${esc(dinero(p.precio))}</span>
      <span class="plan-detalle">${esc(p.detalles || '')}</span>
      <button type="button" data-tipo="${esc(p.idTipo)}" aria-pressed="${p.idTipo === estado.idTipo}">${p.idTipo === estado.idTipo ? 'Seleccionado' : 'Seleccionar'}</button>
    </div>`).join('');
  cont.querySelectorAll('button[data-tipo]').forEach((b) => b.addEventListener('click', () => {
    estado.idTipo = Number(b.dataset.tipo);
    pintarPlanes();
    cotizar();
  }));
}

// ------------------------------------------------------------------ cotización (servidor)
const ERRORES_PROMO = /^(PROMOCION_|REQUISITO_|CLIENTE_REQUERIDO)/;

async function cotizar() {
  const turno = ++estado.turnoCotizacion;
  if (!estado.idTipo) { estado.cotizacion = null; pintarCotizacion(); return; }
  const r = await api('POST', '/ventas/cotizar', {
    codigoCliente: estado.cliente?.codigo, idTipo: estado.idTipo, idPromocion: estado.idPromocion || undefined,
  });
  if (turno !== estado.turnoCotizacion) return; // respuesta vieja
  if (!r.ok && estado.idPromocion && ERRORES_PROMO.test(r.json.codigo || '')) {
    // La promoción ya no aplica (cambió el plan o el cliente): se quita y se avisa
    estado.idPromocion = null;
    aviso($('#mensaje-cobro'), 'info', 'Se quitó la promoción: ' + (r.json.mensaje || 'ya no aplica'));
    return cotizar();
  }
  if (!r.ok) {
    estado.cotizacion = null;
    if (r.json.codigo === 'PLAN_NO_DISPONIBLE') { estado.idTipo = null; await cargarCatalogo(); }
    pintarCotizacion();
    mostrarError(r.json);
    return;
  }
  estado.cotizacion = r.json;
  pintarCotizacion();
}

function pintarCotizacion() {
  const q = estado.cotizacion;
  // Promociones
  const cont = $('#promociones');
  if (!q) cont.innerHTML = '<p class="nota">Selecciona un plan para ver las promociones.</p>';
  else if (!q.promociones.length) cont.innerHTML = '<p class="nota">No hay promociones registradas.</p>';
  else {
    cont.innerHTML = q.promociones.map((p) => {
      const sel = p.idPromocion === estado.idPromocion;
      const periodo = p.fechaInicio || p.fechaFin ? `Vigencia: ${p.fechaInicio ? fecha(p.fechaInicio) : '—'} al ${p.fechaFin ? fecha(p.fechaFin) : 'sin fecha límite'}` : '';
      return `<button type="button" class="promo ${sel ? 'seleccionada' : ''}" data-promo="${esc(p.idPromocion)}" ${p.aplicable ? '' : 'disabled'} aria-pressed="${sel}">
        <span class="promo-nombre">${esc(p.nombre)}${sel ? ' · Aplicada (clic para quitar)' : ''}</span>
        <span class="promo-desc">${esc(p.descripcion || '')}</span>
        ${p.requisito ? `<span class="promo-req">Requisito: ${esc(p.requisito)}</span>` : ''}
        ${periodo ? `<span class="promo-req">${esc(periodo)}</span>` : ''}
        ${p.aplicable ? '' : `<span class="promo-motivo">${esc(p.motivo)}</span>`}
      </button>`;
    }).join('');
    cont.querySelectorAll('button[data-promo]').forEach((b) => b.addEventListener('click', () => {
      const id = Number(b.dataset.promo);
      estado.idPromocion = estado.idPromocion === id ? null : id; // un clic aplica, otro quita (una sola por venta)
      $('#verificacion-texto').value = '';
      $('#verificacion-ok').checked = false;
      cotizar();
    }));
  }
  // Verificación de documento
  const promo = q?.promocion;
  $('#verificacion').hidden = !promo?.requiereVerificacion;
  if (promo?.requiereVerificacion) $('#verificacion-etiqueta').textContent = 'Documento verificado · ' + (promo.requisito || '');

  // Resumen
  const res = $('#resumen');
  if (!q) res.innerHTML = '<p class="nota">Selecciona un plan.</p>';
  else res.innerHTML = `
    <div class="fila-importe"><span>${esc(q.plan.nombre)}</span><span>${esc(dinero(q.precioOriginal))}</span></div>
    ${q.descuento > 0 ? `<div class="fila-importe descuento"><span>${esc(q.descripcionDescuento)}</span><span>-${esc(dinero(q.descuento))}</span></div>` : ''}
    <div class="fila-importe total"><span>Total</span><strong>${esc(dinero(q.total))}</strong></div>`;

  // Vigencia
  const v = q?.vigencia;
  $('#nueva-vigencia').textContent = v ? fecha(v.fin) : '—';
  const detalle = !q ? 'El acceso se libera en el torniquete al confirmar el cobro.'
    : !v ? 'Selecciona un cliente para calcular la vigencia.'
    : (v.tipo === 'RENOVACION' ? `Se suma a su membresía vigente: del ${fecha(v.inicio)} al ${fecha(v.fin)}. `
      : v.tipo === 'REACTIVACION' ? `Su membresía anterior venció; inicia hoy (${fecha(v.inicio)}). `
      : `Del ${fecha(v.inicio)} al ${fecha(v.fin)}. `) + 'El acceso se libera en el torniquete al confirmar el cobro.';
  $('#vigencia-detalle').textContent = detalle;

  actualizarCambio();
}

// ------------------------------------------------------------------ forma de pago
function pintarMetodos() {
  const cont = $('#metodos');
  cont.innerHTML = estado.metodos.map((m) => `<button type="button" class="metodo" role="radio" data-metodo="${esc(m)}" aria-checked="${m === estado.metodo}">${esc(NOMBRE_METODO[m] || m)}</button>`).join('');
  cont.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { estado.metodo = b.dataset.metodo; pintarMetodos(); }));
  const efectivo = estado.metodo === 'EFECTIVO';
  $('#campo-recibe').hidden = !efectivo;
  $('#campo-referencia').hidden = efectivo;
  $('#referencia-etiqueta').textContent = estado.metodo === 'TARJETA' ? 'No. de autorización del voucher' : 'Clave de rastreo de la transferencia';
}

function actualizarCambio() {
  const el = $('#cambio');
  const err = document.querySelector('[data-error="importeRecibido"]');
  const texto = $('#recibe').value.trim();
  err.textContent = '';
  if (!estado.cotizacion || texto === '') { el.textContent = dinero(0); return; }
  const recibido = Number(texto);
  if (!Number.isFinite(recibido) || recibido < 0) { el.textContent = dinero(0); err.textContent = 'Captura un importe válido (no negativo)'; return; }
  const cambio = centavos(recibido) - centavos(estado.cotizacion.total);
  if (cambio < 0) { el.textContent = dinero(0); err.textContent = `Importe insuficiente: faltan ${dinero(-cambio / 100)}`; return; }
  el.textContent = dinero(cambio / 100);
}

// ------------------------------------------------------------------ cobrar
// Validación de captura en pantalla (mensajes inmediatos). El servidor repite TODAS estas reglas.
function validarAntesDeCobrar() {
  const q = estado.cotizacion;
  if (!estado.cliente) return 'Selecciona un cliente';
  if (!estado.cliente.puedeComprar) return estado.cliente.motivoBloqueo;
  if (!estado.idTipo) return 'Selecciona un plan';
  if (!q) return 'No se pudo calcular el total; vuelve a seleccionar el plan';
  if (q.promocion?.requiereVerificacion) {
    if (!$('#verificacion-texto').value.trim()) return 'Indica el documento que verificaste para la promoción ' + q.promocion.nombre;
    if (!$('#verificacion-ok').checked) return 'Confirma que revisaste el documento del cliente';
  }
  if (!estado.metodos.includes(estado.metodo)) return 'Selecciona una forma de pago válida';
  if (estado.metodo === 'EFECTIVO') {
    const t = $('#recibe').value.trim();
    const n = Number(t);
    if (t === '' || !Number.isFinite(n) || n < 0) return 'Captura el importe que entrega el cliente';
    if (centavos(n) < centavos(q.total)) return 'El importe recibido es menor al total';
  } else if (!$('#referencia').value.trim()) return 'Captura la referencia del pago';
  return null;
}

function bloquearCobro(si) {
  estado.procesando = si;
  const b = $('#btn-cobrar');
  b.disabled = si || !estado.planes.length;
  b.textContent = si ? 'Procesando…' : 'Cobrar e imprimir recibo';
  $('#btn-cancelar').disabled = si;
}

async function cobrar() {
  if (estado.procesando) return; // doble clic
  limpiarErroresCampo();
  const error = validarAntesDeCobrar();
  if (error) { aviso($('#mensaje-cobro'), 'error', '✘ ' + error); return; }
  aviso($('#mensaje-cobro'), 'error', '');
  const q = estado.cotizacion;
  const efectivo = estado.metodo === 'EFECTIVO';
  bloquearCobro(true);
  const r = await api('POST', '/ventas', {
    claveIdempotencia: estado.clave,
    codigoCliente: estado.cliente.codigo,
    idTipo: estado.idTipo,
    idPromocion: estado.idPromocion || undefined,
    verificacionRequisito: q.promocion?.requiereVerificacion ? $('#verificacion-texto').value.trim() : undefined,
    metodoPago: estado.metodo,
    importeRecibido: efectivo ? Number($('#recibe').value) : undefined,
    referenciaPago: efectivo ? undefined : $('#referencia').value.trim(),
    totalEsperado: q.total,
  });
  bloquearCobro(false);
  if (r.ok) {
    aviso($('#mensaje-cobro'), r.json.duplicada ? 'info' : 'exito',
      '✔ ' + r.json.mensaje + '. Acceso actualizado en el sistema (torniquete pendiente de integración).');
    if (r.json.recibo) mostrarRecibo(r.json.recibo, true);
    else mostrarReimprimir(r.json.folio);
    return;
  }
  // Errores: la clave NO cambia, así reintentar nunca duplica la venta
  if (r.estado === 0) { aviso($('#mensaje-cobro'), 'error', '✘ No se pudo contactar al servidor. Puedes reintentar: la venta no se duplicará.'); return; }
  mostrarError(r.json);
  if (r.json.codigo === 'PRECIO_CAMBIO') { await cargarCatalogo(); cotizar(); }
  if (r.json.codigo === 'NO_ENCONTRADO' || /^CLIENTE_/.test(r.json.codigo || '')) seleccionarClienteDeNuevo();
}

async function seleccionarClienteDeNuevo() {
  if (!estado.cliente) return;
  const r = await api('GET', '/ventas/clientes/' + encodeURIComponent(estado.cliente.codigo));
  estado.cliente = r.ok ? r.json : null;
  pintarCliente();
}

function mostrarReimprimir(folio) {
  const m = $('#mensaje-cobro');
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'boton-enlace'; b.textContent = 'Reimprimir recibo ' + folio;
  b.addEventListener('click', async () => {
    const r = await api('GET', '/ventas/' + encodeURIComponent(folio));
    if (r.ok) mostrarRecibo(r.json, true); else aviso(m, 'error', '✘ ' + (r.json.mensaje || 'No se pudo generar el recibo'));
  });
  m.append(' ', b);
}

// ------------------------------------------------------------------ recibo
function mostrarRecibo(rc, imprimir) {
  const fila = (a, b, clase = '') => `<div class="r-fila ${clase}"><span>${esc(a)}</span><span>${esc(b)}</span></div>`;
  const [f, h] = String(rc.fechaHora || '').split(' ');
  const zona = $('#zona-recibo');
  zona.innerHTML = `
    <div class="recibo-ventana" role="dialog" aria-modal="true" aria-label="Recibo de pago">
      <div class="recibo">
        <h3>${esc(rc.gimnasio || 'Optimus Gym').toUpperCase()}</h3>
        <div class="centro">Recibo de pago</div>
        <hr>
        ${fila('Folio', rc.folio)}
        ${fila('Fecha', `${fecha(f)} ${h ? h.slice(0, 5) : ''}`)}
        <hr>
        ${fila('Cliente', rc.clienteNombre)}
        ${fila('Código', rc.clienteCodigo)}
        <hr>
        ${fila('Plan', rc.plan)}
        ${fila('Duración', `${rc.duracionDias} ${rc.duracionDias === 1 ? 'día' : 'días'}`)}
        ${fila('Inicio de vigencia', fecha(rc.fechaInicio))}
        ${fila('Vencimiento', fecha(rc.fechaFin))}
        <hr>
        ${fila('Precio', dinero(rc.precioOriginal))}
        ${rc.descuento > 0 ? fila(rc.descripcionDescuento || 'Descuento', '-' + dinero(rc.descuento)) : ''}
        ${rc.verificacionRequisito ? fila('Documento verificado', rc.verificacionRequisito) : ''}
        ${fila('TOTAL PAGADO', dinero(rc.total), 'r-total')}
        ${fila('Método de pago', NOMBRE_METODO[rc.metodoPago] || rc.metodoPago)}
        ${rc.importeRecibido !== null ? fila('Recibido', dinero(rc.importeRecibido)) : ''}
        ${rc.cambio !== null ? fila('Cambio', dinero(rc.cambio)) : ''}
        ${rc.referenciaPago ? fila('Referencia', rc.referenciaPago) : ''}
        ${rc.estatus === 'CANCELADO' ? '<div class="centro"><strong>*** VENTA CANCELADA ***</strong></div>' : ''}
        <hr>
        ${fila('Atendió', `${rc.empleadoNombre} (${rc.empleadoUsuario})`)}
        <div class="centro">¡Gracias por entrenar con nosotros!</div>
      </div>
      <div class="recibo-acciones">
        <button type="button" class="boton-secundario" id="btn-imprimir">Imprimir</button>
        <button type="button" class="boton-cobrar" id="btn-nueva-venta">Nueva venta</button>
      </div>
    </div>`;
  zona.hidden = false;
  document.body.classList.add('con-recibo'); // al imprimir solo sale el recibo (venta.css)
  const imprimirRecibo = () => {
    try { window.print(); } catch { aviso($('#mensaje-cobro'), 'error', '✘ No se pudo abrir la impresión; usa el botón Imprimir del recibo.'); }
  };
  $('#btn-imprimir').addEventListener('click', imprimirRecibo);
  $('#btn-nueva-venta').addEventListener('click', () => { zona.hidden = true; zona.innerHTML = ''; document.body.classList.remove('con-recibo'); reiniciar(); aviso($('#mensaje-cobro'), 'exito', ''); });
  $('#btn-nueva-venta').focus();
  if (imprimir) setTimeout(imprimirRecibo, 50); // deja que el navegador pinte el recibo antes de imprimir
}

// ------------------------------------------------------------------ cancelar / reiniciar
// Limpia TODO lo temporal de la operación (no se guardó nada) y genera una clave nueva.
function reiniciar() {
  estado.cliente = null; estado.idTipo = null; estado.idPromocion = null; estado.cotizacion = null;
  estado.metodo = 'EFECTIVO';
  estado.clave = crypto.randomUUID();
  $('#q-cliente').value = ''; $('#recibe').value = ''; $('#referencia').value = '';
  $('#verificacion-texto').value = ''; $('#verificacion-ok').checked = false;
  $('#resultados-cliente').hidden = true;
  aviso($('#aviso-cliente'), 'info', '');
  limpiarErroresCampo();
  pintarCliente(); pintarPlanes(); pintarMetodos(); pintarCotizacion();
  $('#q-cliente').focus();
}

function cancelar() {
  if (estado.procesando) return;
  const habiaDatos = estado.cliente || estado.idTipo;
  if (!habiaDatos) { location.href = '/#/'; return; } // nada que cancelar → regresa a Clientes
  reiniciar();
  aviso($('#mensaje-cobro'), 'info', 'Operación cancelada. No se registró ninguna venta.');
}

// ------------------------------------------------------------------ inicio
async function cargarCatalogo() {
  const r = await api('GET', '/ventas/catalogo');
  if (!r.ok) {
    aviso($('#aviso-general'), 'error', '✘ ' + (r.json.mensaje || 'No se pudo cargar el catálogo de planes'));
    $('#planes').innerHTML = '<p class="nota">No disponible.</p>';
    return false;
  }
  aviso($('#aviso-general'), 'error', '');
  estado.planes = r.json.planes;
  estado.metodos = r.json.metodosPago;
  if (!estado.metodos.includes(estado.metodo)) estado.metodo = estado.metodos[0];
  pintarPlanes();
  pintarMetodos();
  bloquearCobro(false);
  return true;
}

window.addEventListener('DOMContentLoaded', async () => {
  $('#q-cliente').addEventListener('input', () => { clearTimeout(temporizadorBusqueda); temporizadorBusqueda = setTimeout(buscarClientes, 250); });
  $('#q-cliente').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && resultados.length === 1 && !$('#resultados-cliente').hidden) seleccionarCliente(resultados[0].codigo);
  });
  // Huella: el lector biométrico todavía no está integrado (el comparador del CU-02 es simulado).
  // No se simula una lectura exitosa: solo se informa.
  $('#btn-huella').addEventListener('click', () => aviso($('#aviso-cliente'), 'info',
    'La búsqueda por huella requiere integrar el lector biométrico (SDK), que aún no está conectado. Busca al cliente por nombre, código o celular.'));
  $('#recibe').addEventListener('input', actualizarCambio);
  $('#btn-cobrar').addEventListener('click', cobrar);
  $('#btn-cancelar').addEventListener('click', cancelar);

  pintarCotizacion();
  await cargarCatalogo();
  const codigo = new URLSearchParams(location.search).get('cliente');
  if (codigo) seleccionarCliente(codigo);
});
