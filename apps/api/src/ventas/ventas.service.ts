// SERVICIO DE VENTAS: reglas de negocio del CU-04 Registrar venta de membresía.
// Lo llama ventas.controller.ts. Igual que clientes.service.ts, usa SQL directo con parámetros ($1, $2…).
//
// Principio: el BACKEND decide cuánto se cobra. El navegador solo dice qué cliente, qué plan y qué
// promoción; aquí se leen precio y promoción de la BD, se valida todo y se recalcula el total.
//
// Una venta = 1 fila en membresia_contratada (vigencia) + 1 fila en pago (cobro) + bitácora,
// todo en UNA transacción: si algo falla no queda ni el cobro sin membresía ni la membresía sin cobro.
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorNegocio } from '../comun/errores';
import { SesionDemoService } from '../comun/sesion-demo.service';
import {
  aCentavos, aPesos, calcularCambio, calcularDescuento, calcularVigencia, evaluarPromocion, PromocionEvaluable,
} from './calculos-venta';
import { CotizarVentaDto, METODOS_PAGO, RegistrarVentaDto } from './registrar-venta.dto';

// Roles que pueden cobrar (tabla rol, ver db/semilla.ts)
const ROLES_VENTA = ['Administrador', 'Recepcionista'];

// Filtro SQL (alias mc = membresia_contratada): una membresía cuyo pago fue CANCELADO
// no cuenta para la vigencia ni para el acceso.
const SIN_CANCELAR = `NOT EXISTS (SELECT 1 FROM pago pcan WHERE pcan.id_membresia = mc.id_membresia AND pcan.estatus = 'CANCELADO')`;

type Conexion = DataSource | EntityManager;

interface ClienteVenta {
  id_persona: number; codigo: string; nombre: string; telefono: string; foto: string | null;
  fecha_nacimiento: string; estatus: string; conducta: string; observaciones_acceso: string | null;
}

interface PromocionBD extends PromocionEvaluable {
  idPromocion: number; nombre: string; descripcion: string | null; tipoDescuento: 'MONTO' | 'PORCENTAJE';
  valor: string; requisito: string | null; requiereVerificacion: boolean;
}

@Injectable()
export class VentasService {
  constructor(
    private readonly ds: DataSource,
    private readonly sesion: SesionDemoService,
  ) {}

  /** Planes activos y métodos de pago que se pueden registrar. */
  async catalogo() {
    await this.sesion.exigirRol(...ROLES_VENTA);
    const planes = await this.ds.query(
      `SELECT id_tipo AS "idTipo", nombre, duracion_dias AS "duracionDias", precio, detalles
         FROM tipo_membresia WHERE activa ORDER BY duracion_dias, nombre`);
    return { planes: planes.map((p: any) => ({ ...p, precio: Number(p.precio) })), metodosPago: METODOS_PAGO };
  }

  /** Datos del cliente para la venta: contacto, membresía vigente y estado de acceso. */
  async estadoCliente(codigo: string) {
    await this.sesion.exigirRol(...ROLES_VENTA);
    const c = await this.cargarCliente(codigo, this.ds);
    const hoy = await this.hoy(this.ds);
    const [vigente] = await this.ds.query(
      `SELECT t.nombre AS plan, to_char(mc.fecha_inicio,'YYYY-MM-DD') AS "fechaInicio", to_char(mc.fecha_fin,'YYYY-MM-DD') AS "fechaFin"
         FROM membresia_contratada mc JOIN tipo_membresia t USING (id_tipo)
        WHERE mc.id_cliente = $1 AND mc.fecha_inicio <= $2::date AND mc.fecha_fin >= $2::date AND ${SIN_CANCELAR}
        ORDER BY mc.fecha_fin DESC LIMIT 1`, [c.id_persona, hoy]);
    const ultimoFin = await this.ultimoFin(c.id_persona, this.ds);
    const bloqueo = this.bloqueoCliente(c);
    // Estado de acceso DERIVADO de los datos reales: no hay una bandera que se pueda desincronizar.
    // Mientras no se cobre, una membresía elegida en pantalla no da acceso.
    const acceso = bloqueo ? { permitido: false, motivo: bloqueo.mensaje }
      : vigente ? { permitido: true, motivo: `Acceso vigente hasta ${vigente.fechaFin}` }
      : { permitido: false, motivo: 'Sin acceso hasta cobrar' };
    return {
      codigo: c.codigo, nombre: c.nombre, telefono: c.telefono, foto: c.foto,
      estatus: c.estatus, conducta: c.conducta, observacionesAcceso: c.observaciones_acceso,
      membresiaVigente: vigente ?? null, ultimoFin, acceso,
      puedeComprar: !bloqueo, motivoBloqueo: bloqueo?.mensaje ?? null, hoy,
    };
  }

  /** Resumen del cobro sin guardar nada: precio, promociones aplicables, descuento, total y vigencia. */
  async cotizar(dto: CotizarVentaDto) {
    await this.sesion.exigirRol(...ROLES_VENTA);
    const cliente = dto.codigoCliente ? await this.cargarCliente(dto.codigoCliente, this.ds) : null;
    const calc = await this.calcular(this.ds, dto.idTipo, dto.idPromocion, cliente, await this.hoy(this.ds));
    return {
      plan: calc.plan, promocion: calc.promocion, descripcionDescuento: calc.descripcionDescuento,
      precioOriginal: aPesos(calc.precioCent), descuento: aPesos(calc.descuentoCent), total: aPesos(calc.totalCent),
      vigencia: calc.vigencia, promociones: calc.promociones,
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
        const calc = await this.calcular(m, dto.idTipo, dto.idPromocion, c, hoy);

        // Promociones con documento: recepción debe registrar qué verificó; no se asume que el cliente cumple.
        if (calc.promocion?.requiereVerificacion && !dto.verificacionRequisito)
          throw new ErrorNegocio('VERIFICACION_REQUERIDA', `La promoción "${calc.promocion.nombre}" requiere verificar: ${calc.promocion.requisito}`, 422,
            { verificacionRequisito: 'Indica el documento revisado' });

        // El precio (o la promoción) cambió desde que se mostró el resumen → no cobrar un importe distinto al que vio el cliente
        if (aCentavos(dto.totalEsperado) !== calc.totalCent)
          throw new ErrorNegocio('PRECIO_CAMBIO', `El total cambió a $${aPesos(calc.totalCent).toFixed(2)}. Revisa el resumen y confirma de nuevo.`, 409,
            undefined, { total: aPesos(calc.totalCent) });

        // Forma de pago
        let recibidoCent: number | null = null;
        let cambioCent: number | null = null;
        let referencia: string | null = null;
        if (dto.metodoPago === 'EFECTIVO') {
          if (dto.importeRecibido === undefined || dto.importeRecibido === null)
            throw new ErrorNegocio('IMPORTE_REQUERIDO', 'Captura el importe que entrega el cliente', 422, { importeRecibido: 'Obligatorio en efectivo' });
          recibidoCent = aCentavos(dto.importeRecibido);
          cambioCent = calcularCambio(calc.totalCent, recibidoCent);
          if (cambioCent === null)
            throw new ErrorNegocio('IMPORTE_INSUFICIENTE',
              `El importe recibido ($${aPesos(recibidoCent).toFixed(2)}) es menor al total ($${aPesos(calc.totalCent).toFixed(2)})`, 422,
              { importeRecibido: 'Importe insuficiente' });
        } else {
          // Sin terminal ni pasarela integradas: solo se REGISTRA el cobro hecho fuera del sistema con su referencia.
          referencia = dto.referenciaPago || null;
          if (!referencia)
            throw new ErrorNegocio('REFERENCIA_REQUERIDA',
              dto.metodoPago === 'TARJETA' ? 'Captura el número de autorización del voucher' : 'Captura la clave de rastreo de la transferencia', 422,
              { referenciaPago: 'Obligatorio para ' + dto.metodoPago.toLowerCase() });
        }

        const v = calc.vigencia!; // con cliente siempre hay vigencia
        etapa = 'membresia';
        const [mem] = await m.query(
          'INSERT INTO membresia_contratada (id_cliente, id_tipo, fecha_inicio, fecha_fin) VALUES ($1,$2,$3,$4) RETURNING id_membresia',
          [c.id_persona, calc.plan.idTipo, v.inicio, v.fin]);
        etapa = 'venta';
        const [pago] = await m.query(
          `INSERT INTO pago (id_membresia, id_empleado, monto, descuento, metodo_pago, plan_nombre, plan_duracion_dias, precio_original,
                             id_promocion, descripcion_descuento, verificacion_requisito, importe_recibido, cambio, referencia_pago, clave_idempotencia)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id_pago, folio_recibo`,
          [mem.id_membresia, idEmpleado, aPesos(calc.totalCent), aPesos(calc.descuentoCent), dto.metodoPago,
           calc.plan.nombre, calc.plan.duracionDias, aPesos(calc.precioCent),
           calc.promocion?.idPromocion ?? null, calc.descripcionDescuento,
           calc.promocion?.requiereVerificacion ? dto.verificacionRequisito : null,
           recibidoCent === null ? null : aPesos(recibidoCent), cambioCent === null ? null : aPesos(cambioCent),
           referencia, dto.claveIdempotencia]);
        await m.query(
          `INSERT INTO registro_auditoria (id_empleado, id_persona, accion, detalle, entidad_afectada, id_registro_afectado)
           VALUES ($1,$2,'VENTA_MEMBRESIA',$3,'pago',$4)`,
          [idEmpleado, c.id_persona,
           `${pago.folio_recibo} · ${calc.plan.nombre} · ${v.tipo} ${v.inicio} a ${v.fin} · total ${aPesos(calc.totalCent).toFixed(2)} · ${dto.metodoPago}`
             + (calc.promocion ? ` · promoción ${calc.promocion.nombre}` : ''),
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
              p.telefono, p.foto, to_char(p.fecha_nacimiento,'YYYY-MM-DD') AS fecha_nacimiento,
              c.estatus, c.conducta, c.observaciones_acceso
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

  /** Fecha de fin más lejana de las membresías no canceladas del cliente (null si nunca tuvo). */
  private async ultimoFin(idPersona: number, m: Conexion): Promise<string | null> {
    const [r] = await m.query(
      `SELECT to_char(max(mc.fecha_fin),'YYYY-MM-DD') AS fin FROM membresia_contratada mc WHERE mc.id_cliente = $1 AND ${SIN_CANCELAR}`, [idPersona]);
    return r.fin;
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
  private async calcular(m: Conexion, idTipo: number, idPromocion: number | undefined, cliente: ClienteVenta | null, hoy: string) {
    const [plan] = await m.query(
      `SELECT id_tipo AS "idTipo", nombre, duracion_dias AS "duracionDias", precio, detalles
         FROM tipo_membresia WHERE id_tipo = $1 AND activa`, [idTipo]);
    if (!plan) throw new ErrorNegocio('PLAN_NO_DISPONIBLE', 'El plan seleccionado no existe o ya no está disponible', 404);

    const promos: PromocionBD[] = await m.query(
      `SELECT pr.id_promocion AS "idPromocion", pr.nombre, pr.descripcion, pr.tipo_descuento AS "tipoDescuento", pr.valor,
              to_char(pr.fecha_inicio,'YYYY-MM-DD') AS "fechaInicio", to_char(pr.fecha_fin,'YYYY-MM-DD') AS "fechaFin",
              pr.requisito, pr.requiere_verificacion AS "requiereVerificacion", pr.edad_minima AS "edadMinima", pr.activa,
              coalesce(array_agg(ptm.id_tipo) FILTER (WHERE ptm.id_tipo IS NOT NULL), '{}') AS planes
         FROM promocion pr LEFT JOIN promocion_tipo_membresia ptm USING (id_promocion)
        WHERE pr.activa GROUP BY pr.id_promocion ORDER BY pr.nombre`);
    const fechaNac = cliente?.fecha_nacimiento ?? null;
    const promociones = promos.map((p) => {
      const motivo = evaluarPromocion(p, plan.idTipo, hoy, fechaNac);
      return {
        idPromocion: p.idPromocion, nombre: p.nombre, descripcion: p.descripcion, tipoDescuento: p.tipoDescuento,
        valor: Number(p.valor), fechaInicio: p.fechaInicio, fechaFin: p.fechaFin, requisito: p.requisito,
        requiereVerificacion: p.requiereVerificacion, aplicable: !motivo, motivo: motivo?.mensaje ?? null,
      };
    });

    const precioCent = aCentavos(plan.precio);
    let descuentoCent = 0;
    let promocion: (typeof promociones)[number] | null = null;
    if (idPromocion) {
      const p = promos.find((x) => x.idPromocion === idPromocion);
      if (!p) throw new ErrorNegocio('PROMOCION_NO_DISPONIBLE', 'La promoción no existe o ya no está disponible', 422);
      const motivo = evaluarPromocion(p, plan.idTipo, hoy, fechaNac);
      if (motivo) throw new ErrorNegocio(motivo.codigo, motivo.mensaje, 422);
      descuentoCent = calcularDescuento(precioCent, p.tipoDescuento, p.valor);
      promocion = promociones.find((x) => x.idPromocion === idPromocion)!;
    }

    let vigencia = null;
    if (cliente) vigencia = calcularVigencia(hoy, await this.ultimoFin(cliente.id_persona, m), plan.duracionDias);

    return {
      plan: { idTipo: plan.idTipo, nombre: plan.nombre, duracionDias: plan.duracionDias, precio: Number(plan.precio), detalles: plan.detalles },
      promocion, promociones, vigencia, precioCent, descuentoCent, totalCent: precioCent - descuentoCent,
      descripcionDescuento: promocion ? `Descuento ${promocion.nombre.toLowerCase()}` : null,
    };
  }

  /** Lee el recibo desde la BD (lo impreso = lo guardado). 404 si el folio no existe. */
  private async leerRecibo(folio: string) {
    const [r] = await this.ds.query(
      `SELECT pa.folio_recibo AS folio, to_char(pa.fecha_hora,'YYYY-MM-DD HH24:MI:SS') AS "fechaHora", pa.estatus,
              coalesce(pa.plan_nombre, t.nombre) AS plan, coalesce(pa.plan_duracion_dias, t.duracion_dias) AS "duracionDias",
              to_char(mc.fecha_inicio,'YYYY-MM-DD') AS "fechaInicio", to_char(mc.fecha_fin,'YYYY-MM-DD') AS "fechaFin",
              coalesce(pa.precio_original, pa.monto + pa.descuento) AS "precioOriginal", pa.descuento,
              pa.descripcion_descuento AS "descripcionDescuento", pa.verificacion_requisito AS "verificacionRequisito",
              pa.monto AS total, pa.metodo_pago AS "metodoPago", pa.importe_recibido AS "importeRecibido", pa.cambio,
              pa.referencia_pago AS "referenciaPago",
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
      precioOriginal: num(r.precioOriginal), descuento: num(r.descuento), total: num(r.total),
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
