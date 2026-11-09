// SERVICIO DE VENTAS: reglas de negocio del CU-04 Registrar venta de membresía.
// Lo llama ventas.controller.ts. Igual que clientes.service.ts, usa SQL directo con parámetros ($1, $2…).
//
// Principio: el BACKEND decide cuánto se cobra. El navegador solo dice qué cliente y qué plan;
// aquí se lee el precio de la BD, se valida todo y se recalcula el total. (Sin promociones por ahora.)
//
// Vigencia: la membresía nueva REEMPLAZA a la anterior (no se apilan días). La "membresía actual" de un
// cliente es siempre la ÚLTIMA que se le vendió; las anteriores quedan como historial y ya no dan acceso.
// Una membresía vigente solo se reemplaza si le faltan menos de 7 días (si no → MEMBRESIA_VIGENTE) y si la
// nueva vence DESPUÉS que ella (si no → PLAN_VENCE_ANTES); en ese caso se advierte que se sobrescribirá su vencimiento.
//
// Una venta = 1 fila en membresia_contratada (vigencia) + 1 fila en pago (cobro) + bitácora,
// todo en UNA transacción: si algo falla no queda ni el cobro sin membresía ni la membresía sin cobro.
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorNegocio } from '../comun/errores';
import { SesionDemoService } from '../comun/sesion-demo.service';
import { aCentavos, aPesos, calcularCambio, calcularVigencia, planDisponibleEn, revisarReemplazo } from './calculos-venta';
import { CotizarVentaDto, METODOS_PAGO, RegistrarVentaDto } from './registrar-venta.dto';

// Roles que pueden cobrar (tabla rol, ver db/semilla.ts)
const ROLES_VENTA = ['Administrador', 'Recepcionista'];

// Filtro SQL (alias mc = membresia_contratada): una membresía cuyo pago fue CANCELADO
// no cuenta para la vigencia ni para el acceso.
const SIN_CANCELAR = `NOT EXISTS (SELECT 1 FROM pago pcan WHERE pcan.id_membresia = mc.id_membresia AND pcan.estatus = 'CANCELADO')`;

type Conexion = DataSource | EntityManager;

interface ClienteVenta {
  id_persona: number; codigo: string; nombre: string; telefono: string; foto: string | null;
  estatus: string; conducta: string; observaciones_acceso: string | null;
}

interface MembresiaActual { plan: string; fechaInicio: string; fechaFin: string }

@Injectable()
export class VentasService {
  constructor(
    private readonly ds: DataSource,
    private readonly sesion: SesionDemoService,
  ) {}

  /** Planes activos, métodos de pago y quién atiende (se muestra en la barra lateral). */
  async catalogo() {
    const idEmpleado = await this.sesion.exigirRol(...ROLES_VENTA);
    const hoy = await this.hoy(this.ds);
    const todos = await this.ds.query(
      `SELECT id_tipo AS "idTipo", nombre, duracion_dias AS "duracionDias", precio, detalles, dias_disponibles AS "diasDisponibles"
         FROM tipo_membresia WHERE activa ORDER BY duracion_dias, nombre`);
    // Planes con días del mes fijos (ej. "Precio especial" solo el 1 y el 15) se ocultan el resto de los días
    const planes = todos.filter((p: any) => planDisponibleEn(p.diasDisponibles, hoy));
    const [atiende] = await this.ds.query(
      `SELECT trim(p.nombres || ' ' || p.apellido_paterno) AS nombre,
              (SELECT string_agg(r.nombre, ', ' ORDER BY r.nombre) FROM empleado_rol er JOIN rol r USING (id_rol)
                WHERE er.id_persona = p.id_persona) AS rol
         FROM persona p WHERE p.id_persona = $1`, [idEmpleado]);
    return { planes: planes.map((p: any) => ({ ...p, precio: Number(p.precio) })), metodosPago: METODOS_PAGO, atiende };
  }

  /** Datos del cliente para la venta: contacto, membresía vigente y estado de acceso. */
  async estadoCliente(codigo: string) {
    await this.sesion.exigirRol(...ROLES_VENTA);
    const c = await this.cargarCliente(codigo, this.ds);
    const hoy = await this.hoy(this.ds);
    const actual = await this.membresiaActual(c.id_persona, this.ds);
    // Solo la membresía actual cuenta: si ya venció, no da acceso (las anteriores fueron reemplazadas)
    const vigente = actual && actual.fechaInicio <= hoy && actual.fechaFin >= hoy ? actual : null;
    const bloqueo = this.bloqueoCliente(c);
    // Estado de acceso DERIVADO de los datos reales: no hay una bandera que se pueda desincronizar.
    // Mientras no se cobre, una membresía elegida en pantalla no da acceso.
    const acceso = bloqueo ? { permitido: false, motivo: bloqueo.mensaje }
      : vigente ? { permitido: true, motivo: `Acceso vigente hasta ${vigente.fechaFin}` }
      : { permitido: false, motivo: 'Sin acceso hasta cobrar' };
    return {
      codigo: c.codigo, nombre: c.nombre, telefono: c.telefono, foto: c.foto,
      estatus: c.estatus, conducta: c.conducta, observacionesAcceso: c.observaciones_acceso,
      membresiaVigente: vigente, ultimoFin: actual?.fechaFin ?? null, acceso,
      puedeComprar: !bloqueo, motivoBloqueo: bloqueo?.mensaje ?? null, hoy,
    };
  }

  /**
   * Resumen del cobro sin guardar nada: precio, total y vigencia.
   * No lanza error si la membresía actual no se puede reemplazar: lo informa en "bloqueo" ({ codigo, mensaje })
   * para que la pantalla lo muestre (registrar() sí lo rechaza). "advertencia" avisa que se sobrescribirá el vencimiento.
   */
  async cotizar(dto: CotizarVentaDto) {
    await this.sesion.exigirRol(...ROLES_VENTA);
    const cliente = dto.codigoCliente ? await this.cargarCliente(dto.codigoCliente, this.ds) : null;
    const calc = await this.calcular(this.ds, dto.idTipo, cliente, await this.hoy(this.ds));
    return {
      plan: calc.plan, precioOriginal: aPesos(calc.precioCent), total: aPesos(calc.totalCent), vigencia: calc.vigencia,
      bloqueo: calc.reemplazo.bloqueo,
      advertencia: calc.reemplazo.advertencia,
    };
  }

  /** CU-04 FB: registra la venta. Idempotente por claveIdempotencia (doble clic / reintento → misma venta). */
  async registrar(dto: RegistrarVentaDto) {
    const idEmpleado = await this.sesion.exigirRol(...ROLES_VENTA);

    // ¿Esta misma operación ya se registró? (reintento después de un error de red, doble envío…)
    const previa = await this.ventaPorClave(dto.claveIdempotencia, dto.codigoCliente, this.ds);
    if (previa) return this.respuesta(previa, true);

    let etapa = 'venta'; // para decir qué falló si PostgreSQL rechaza algo
    let folio: string;
    let duplicada = false;
    try {
      ({ folio, duplicada } = await this.ds.transaction(async (m) => {
        // FOR UPDATE bloquea la fila del cliente hasta el COMMIT: dos cobros simultáneos del mismo
        // cliente se forman en fila, así ninguno calcula la vigencia con datos viejos ni se duplica.
        const c = await this.cargarCliente(dto.codigoCliente, m, true);
        const ya = await this.ventaPorClave(dto.claveIdempotencia, dto.codigoCliente, m);
        if (ya) return { folio: ya, duplicada: true };

        const bloqueo = this.bloqueoCliente(c);
        if (bloqueo) throw new ErrorNegocio(bloqueo.codigo, bloqueo.mensaje, 409);

        const hoy = await this.hoy(m);
        const calc = await this.calcular(m, dto.idTipo, c, hoy);

        // A la membresía vigente aún le quedan 7 días o más, o el plan nuevo no vence después que ella
        if (calc.reemplazo.bloqueo) throw new ErrorNegocio(calc.reemplazo.bloqueo.codigo, calc.reemplazo.bloqueo.mensaje, 409);

        // El precio cambió desde que se mostró el resumen → no cobrar un importe distinto al que vio el cliente
        if (aCentavos(dto.totalEsperado) !== calc.totalCent)
          throw new ErrorNegocio('PRECIO_CAMBIO', `El total cambió a $${aPesos(calc.totalCent).toFixed(2)}. Revisa el resumen y confirma de nuevo.`, 409,
            undefined, { total: aPesos(calc.totalCent) });

        // Forma de pago. Tarjeta y transferencia se cobran fuera del sistema (terminal / banco): solo se registra el método.
        let recibidoCent: number | null = null;
        let cambioCent: number | null = null;
        if (dto.metodoPago === 'EFECTIVO') {
          if (dto.importeRecibido === undefined || dto.importeRecibido === null)
            throw new ErrorNegocio('IMPORTE_REQUERIDO', 'Captura el importe que entrega el cliente', 422, { importeRecibido: 'Obligatorio en efectivo' });
          recibidoCent = aCentavos(dto.importeRecibido);
          cambioCent = calcularCambio(calc.totalCent, recibidoCent);
          if (cambioCent === null)
            throw new ErrorNegocio('IMPORTE_INSUFICIENTE',
              `El importe recibido ($${aPesos(recibidoCent).toFixed(2)}) es menor al total ($${aPesos(calc.totalCent).toFixed(2)})`, 422,
              { importeRecibido: 'Importe insuficiente' });
        }

        const v = calc.vigencia!; // con cliente siempre hay vigencia
        etapa = 'membresia';
        // La anterior NO se borra ni se modifica (historial): deja de contar porque esta pasa a ser la última vendida.
        const [mem] = await m.query(
          'INSERT INTO membresia_contratada (id_cliente, id_tipo, fecha_inicio, fecha_fin) VALUES ($1,$2,$3,$4) RETURNING id_membresia',
          [c.id_persona, calc.plan.idTipo, v.inicio, v.fin]);
        etapa = 'venta';
        const [pago] = await m.query(
          `INSERT INTO pago (id_membresia, id_empleado, monto, descuento, metodo_pago, plan_nombre, plan_duracion_dias, precio_original,
                             importe_recibido, cambio, clave_idempotencia)
           VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8,$9,$10) RETURNING id_pago, folio_recibo`,
          [mem.id_membresia, idEmpleado, aPesos(calc.totalCent), dto.metodoPago,
           calc.plan.nombre, calc.plan.duracionDias, aPesos(calc.precioCent),
           recibidoCent === null ? null : aPesos(recibidoCent), cambioCent === null ? null : aPesos(cambioCent),
           dto.claveIdempotencia]);
        await m.query(
          `INSERT INTO registro_auditoria (id_empleado, id_persona, accion, detalle, entidad_afectada, id_registro_afectado)
           VALUES ($1,$2,'VENTA_MEMBRESIA',$3,'pago',$4)`,
          [idEmpleado, c.id_persona,
           `${pago.folio_recibo} · ${calc.plan.nombre} · ${v.tipo} ${v.inicio} a ${v.fin} · total ${aPesos(calc.totalCent).toFixed(2)} · ${dto.metodoPago}`,
           pago.id_pago]);
        // TORNIQUETE: aún no hay integración. El acceso se deriva de membresia_contratada (ver estadoCliente),
        // así que al hacer COMMIT el cliente ya figura con acceso; aquí se notificará al controlador cuando exista.
        return { folio: pago.folio_recibo as string, duplicada: false };
      }));
    } catch (e: any) {
      if (e instanceof ErrorNegocio) throw e;
      // Carrera rarísima: la misma clave entró por otra conexión justo antes → se devuelve esa venta
      if (e?.code === '23505' && String(e?.constraint ?? '').includes('clave_idempotencia')) {
        const ya = await this.ventaPorClave(dto.claveIdempotencia, dto.codigoCliente, this.ds);
        if (ya) return this.respuesta(ya, true);
      }
      throw this.errorPersistencia(e, etapa);
    }
    return this.respuesta(folio, duplicada);
  }

  /** Recibo de una venta ya registrada (para mostrar o reimprimir). */
  async recibo(folio: string) {
    await this.sesion.exigirRol(...ROLES_VENTA);
    return this.leerRecibo(folio);
  }

  // ------------------------------------------------------------------ auxiliares

  /** Arma la respuesta de registrar(). Si el recibo falla, la venta YA está guardada: se avisa para reimprimir. */
  private async respuesta(folio: string, duplicada: boolean) {
    let recibo = null;
    try { recibo = await this.leerRecibo(folio); } catch (e) { console.error(e); }
    const mensaje = duplicada
      ? `Esta venta ya estaba registrada con el folio ${folio}; no se cobró dos veces`
      : recibo ? `Venta registrada con el folio ${folio}`
      : `Venta registrada con el folio ${folio}, pero no se pudo generar el recibo. Usa "Reimprimir".`;
    return { folio, duplicada, recibo, mensaje };
  }

  /** Fecha de hoy según PostgreSQL ('AAAA-MM-DD'): la misma que usan las fechas guardadas. */
  private async hoy(m: Conexion): Promise<string> {
    const [r] = await m.query(`SELECT to_char(CURRENT_DATE,'YYYY-MM-DD') AS hoy`);
    return r.hoy;
  }

  /** Cliente por código; 404 si no existe. Con bloquear=true toma un candado de fila (dentro de una transacción). */
  private async cargarCliente(codigo: string, m: Conexion, bloquear = false): Promise<ClienteVenta> {
    const [c] = await m.query(
      `SELECT p.id_persona, p.codigo,
              trim(p.nombres || ' ' || p.apellido_paterno || ' ' || coalesce(p.apellido_materno,'')) AS nombre,
              p.telefono, p.foto, c.estatus, c.conducta, c.observaciones_acceso
         FROM cliente c JOIN persona p USING (id_persona)
        WHERE p.codigo = $1 ${bloquear ? 'FOR UPDATE OF c' : ''}`, [codigo]);
    if (!c) throw new ErrorNegocio('NO_ENCONTRADO', 'No existe un cliente con ese código', 404);
    return c;
  }

  /** Motivo por el que el cliente NO puede comprar, o null si sí puede. */
  private bloqueoCliente(c: ClienteVenta) {
    if (c.estatus === 'INACTIVO') return { codigo: 'CLIENTE_INACTIVO', mensaje: 'El cliente está inactivo; reactívalo en Clientes antes de cobrar' };
    if (c.conducta === 'VETADO') return { codigo: 'CLIENTE_VETADO', mensaje: 'El cliente está vetado; no se le pueden vender membresías' };
    return null;
  }

  /** Membresía actual del cliente = la ÚLTIMA que se le vendió (no cancelada), aunque ya esté vencida. null si nunca tuvo. */
  private async membresiaActual(idPersona: number, m: Conexion): Promise<MembresiaActual | null> {
    const [r] = await m.query(
      `SELECT t.nombre AS plan, to_char(mc.fecha_inicio,'YYYY-MM-DD') AS "fechaInicio", to_char(mc.fecha_fin,'YYYY-MM-DD') AS "fechaFin"
         FROM membresia_contratada mc JOIN tipo_membresia t USING (id_tipo)
        WHERE mc.id_cliente = $1 AND ${SIN_CANCELAR}
        ORDER BY mc.fecha_fin DESC LIMIT 1`, [idPersona]);
    return r ?? null;
  }

  /** Folio de la venta ya registrada con esa clave, o null. Si la clave se usó con OTRO cliente → 409. */
  private async ventaPorClave(clave: string, codigoCliente: string, m: Conexion): Promise<string | null> {
    const [r] = await m.query(
      `SELECT pa.folio_recibo, p.codigo FROM pago pa
         JOIN membresia_contratada mc USING (id_membresia) JOIN persona p ON p.id_persona = mc.id_cliente
        WHERE pa.clave_idempotencia = $1`, [clave]);
    if (!r) return null;
    if (r.codigo !== codigoCliente)
      throw new ErrorNegocio('CLAVE_REUTILIZADA', 'Esta operación ya se usó para otra venta; recarga la pantalla e inicia una venta nueva', 409);
    return r.folio_recibo;
  }

  /** Núcleo del cálculo (lo comparten cotizar y registrar, así no puede haber dos versiones de la regla). */
  private async calcular(m: Conexion, idTipo: number, cliente: ClienteVenta | null, hoy: string) {
    const [plan] = await m.query(
      `SELECT id_tipo AS "idTipo", nombre, duracion_dias AS "duracionDias", precio, detalles, dias_disponibles AS "diasDisponibles"
         FROM tipo_membresia WHERE id_tipo = $1 AND activa`, [idTipo]);
    if (!plan) throw new ErrorNegocio('PLAN_NO_DISPONIBLE', 'El plan seleccionado no existe o ya no está disponible', 404);
    // Se revisa también aquí: la pantalla pudo quedar abierta de un día para otro (ej. del 15 al 16)
    if (!planDisponibleEn(plan.diasDisponibles, hoy))
      throw new ErrorNegocio('PLAN_NO_DISPONIBLE', `El plan ${plan.nombre} solo se vende los días ${plan.diasDisponibles.join(' y ')} de cada mes`, 404);

    let vigencia = null;
    let reemplazo: ReturnType<typeof revisarReemplazo> = { bloqueo: null, advertencia: null };
    if (cliente) {
      const actual = await this.membresiaActual(cliente.id_persona, m);
      vigencia = calcularVigencia(hoy, actual?.fechaFin ?? null, plan.duracionDias);
      reemplazo = revisarReemplazo(hoy, actual?.fechaFin ?? null, vigencia.fin, actual?.plan);
    }

    const precioCent = aCentavos(plan.precio);
    return {
      plan: { idTipo: plan.idTipo, nombre: plan.nombre, duracionDias: plan.duracionDias, precio: Number(plan.precio), detalles: plan.detalles },
      vigencia, reemplazo, precioCent, totalCent: precioCent, // sin promociones: total = precio
    };
  }

  /** Lee el recibo desde la BD (lo impreso = lo guardado). 404 si el folio no existe. */
  private async leerRecibo(folio: string) {
    const [r] = await this.ds.query(
      `SELECT pa.folio_recibo AS folio, to_char(pa.fecha_hora,'YYYY-MM-DD HH24:MI:SS') AS "fechaHora", pa.estatus,
              coalesce(pa.plan_nombre, t.nombre) AS plan, coalesce(pa.plan_duracion_dias, t.duracion_dias) AS "duracionDias",
              to_char(mc.fecha_inicio,'YYYY-MM-DD') AS "fechaInicio", to_char(mc.fecha_fin,'YYYY-MM-DD') AS "fechaFin",
              coalesce(pa.precio_original, pa.monto + pa.descuento) AS "precioOriginal",
              pa.monto AS total, pa.metodo_pago AS "metodoPago", pa.importe_recibido AS "importeRecibido", pa.cambio,
              pc.codigo AS "clienteCodigo",
              trim(pc.nombres || ' ' || pc.apellido_paterno || ' ' || coalesce(pc.apellido_materno,'')) AS "clienteNombre",
              e.nombre_usuario AS "empleadoUsuario", trim(pe.nombres || ' ' || pe.apellido_paterno) AS "empleadoNombre"
         FROM pago pa
         JOIN membresia_contratada mc USING (id_membresia)
         JOIN tipo_membresia t ON t.id_tipo = mc.id_tipo
         JOIN persona pc ON pc.id_persona = mc.id_cliente
         JOIN empleado e ON e.id_persona = pa.id_empleado
         JOIN persona pe ON pe.id_persona = e.id_persona
        WHERE pa.folio_recibo = $1`, [folio]);
    if (!r) throw new ErrorNegocio('NO_ENCONTRADO', 'No existe una venta con ese folio', 404);
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      gimnasio: 'Optimus Gym', ...r,
      precioOriginal: num(r.precioOriginal), total: num(r.total),
      importeRecibido: num(r.importeRecibido), cambio: num(r.cambio),
    };
  }

  /** Convierte un error inesperado de PostgreSQL en un mensaje claro. La transacción ya hizo ROLLBACK. */
  private errorPersistencia(e: any, etapa: string) {
    const codigo = String(e?.code ?? '');
    if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', '57P01', '57P03'].includes(codigo) || codigo.startsWith('08'))
      return new ErrorNegocio('BD_NO_DISPONIBLE', 'No hay conexión con la base de datos. La venta NO se registró; intenta de nuevo.', 503);
    console.error(e);
    return etapa === 'membresia'
      ? new ErrorNegocio('ERROR_MEMBRESIA', 'No se pudo actualizar la membresía. No se registró ningún cobro; puedes volver a intentar.', 500)
      : new ErrorNegocio('ERROR_GUARDAR_VENTA', 'No se pudo guardar la venta. No se registró ningún cobro ni cambió la membresía; puedes volver a intentar.', 500);
  }
}
