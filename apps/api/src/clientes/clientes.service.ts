import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CifradoService } from '../comun/cifrado.service';
import { ErrorNegocio } from '../comun/errores';
import { SesionDemoService } from '../comun/sesion-demo.service';
import { CALIDAD_MINIMA, ComparadorHuellasService, UMBRAL_DUPLICADO } from '../huellas/comparador-huellas.service';
import { RegistrarClienteDto } from './registrar-cliente.dto';

@Injectable()
export class ClientesService {
  constructor(
    private readonly ds: DataSource,
    private readonly cifrado: CifradoService,
    private readonly comparador: ComparadorHuellasService,
    private readonly sesion: SesionDemoService,
  ) {}

  /** OP-CU02-01 registrarCliente (FB-01 y flujos alternativos FA-01, FA-02, FA-05, FA-06, FA-08). */
  async registrarCliente(dto: RegistrarClienteDto) {
    const idEmpleado = await this.sesion.idEmpleadoActual();

    // FA-06: reglas de datos
    const nac = new Date(dto.fechaNacimiento);
    if (isNaN(nac.getTime()) || nac > new Date())
      throw new ErrorNegocio('DATOS_INVALIDOS', 'La fecha de nacimiento no es válida', 422, { fechaNacimiento: 'No puede ser futura' });

    // FA-08: alta sin huella exige motivo
    if (!dto.huella && !dto.observacionesAcceso?.trim())
      throw new ErrorNegocio('MOTIVO_REQUERIDO', 'Sin huella, debes registrar el motivo en Observaciones de acceso', 422,
        { observacionesAcceso: 'Obligatorio cuando no se enrola huella' });

    // FA-02: calidad mínima
    let plantilla: Buffer | undefined;
    if (dto.huella) {
      if (dto.huella.calidad < CALIDAD_MINIMA())
        throw new ErrorNegocio('CALIDAD_INSUFICIENTE', `La calidad de la huella (${dto.huella.calidad}) es menor a ${CALIDAD_MINIMA()}. Vuelve a capturar.`, 422);
      plantilla = Buffer.from(dto.huella.plantillaBase64, 'base64');
      if (!plantilla.length) throw new ErrorNegocio('DATOS_INVALIDOS', 'Plantilla de huella vacía', 422);
    }

    // FA-01: correo o teléfono ya registrados
    const dup = await this.ds.query(
      `SELECT p.id_persona, p.codigo, p.correo, p.telefono,
              EXISTS(SELECT 1 FROM cliente c WHERE c.id_persona = p.id_persona) AS es_cliente,
              EXISTS(SELECT 1 FROM empleado e WHERE e.id_persona = p.id_persona) AS es_empleado
         FROM persona p WHERE lower(p.correo) = lower($1) OR p.telefono = $2`,
      [dto.correo, dto.telefono]);
    if (dup.length) {
      const d = dup[0];
      throw new ErrorNegocio('DUPLICADO',
        d.es_empleado && !d.es_cliente
          ? 'La persona ya existe como empleado; confirma si deseas agregarla también como cliente'
          : 'Ya existe una persona con ese correo o teléfono',
        409, undefined, { codigoExistente: d.codigo, esEmpleado: d.es_empleado, esCliente: d.es_cliente });
    }

    // FA-05: huella duplicada (búsqueda 1:N contra plantillas existentes)
    let enc: { cifrado: Buffer; iv: Buffer } | undefined;
    if (plantilla) {
      const todas = await this.ds.query(
        `SELECT pb.plantilla_cifrada, pb.vector_inicializacion, p.codigo
           FROM plantilla_biometrica pb JOIN persona p USING (id_persona)`);
      for (const t of todas) {
        const sim = this.comparador.similitud(plantilla, this.cifrado.descifrar(t.plantilla_cifrada, t.vector_inicializacion));
        if (sim >= UMBRAL_DUPLICADO())
          throw new ErrorNegocio('HUELLA_DUPLICADA', 'Esta huella ya está enrolada en otra persona', 409, undefined,
            { codigoExistente: t.codigo, similitud: Math.round(sim) });
      }
      enc = this.cifrado.cifrar(plantilla); // RE-02
    }

    // RE-05: transacción atómica
    try {
      return await this.ds.transaction(async (m) => {
        const [p] = await m.query(
          `INSERT INTO persona (nombres, apellido_paterno, apellido_materno, fecha_nacimiento, sexo, telefono, correo)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id_persona, codigo`,
          [dto.nombres.trim(), dto.apellidoPaterno.trim(), dto.apellidoMaterno?.trim() || null,
           dto.fechaNacimiento, dto.sexo, dto.telefono, dto.correo.trim()]);
        await m.query('INSERT INTO cliente (id_persona, observaciones_acceso) VALUES ($1,$2)', [p.id_persona, dto.observacionesAcceso?.trim() || null]);
        await m.query('INSERT INTO contacto_emergencia (id_persona, nombre, telefono, parentesco) VALUES ($1,$2,$3,$4)',
          [p.id_persona, dto.contactoEmergencia.nombre, dto.contactoEmergencia.telefono, dto.contactoEmergencia.parentesco ?? null]);
        if (enc && dto.huella) {
          await m.query(
            `INSERT INTO plantilla_biometrica (id_persona, dedo, plantilla_cifrada, vector_inicializacion, calidad, formato_plantilla, version_sdk)
             VALUES ($1,$2,$3,$4,$5,'SIMULADO','0')`,
            [p.id_persona, dto.huella.dedo, enc.cifrado, enc.iv, dto.huella.calidad]);
        }
        await m.query(
          `INSERT INTO registro_auditoria (id_empleado, id_persona, accion, motivo, entidad_afectada, id_registro_afectado)
           VALUES ($1,$2,$3,$4,'cliente',$2)`,
          [idEmpleado, p.id_persona, dto.huella ? 'ALTA_CLIENTE' : 'ALTA_CLIENTE_SIN_HUELLA', dto.huella ? null : dto.observacionesAcceso]);
        return { codigo: p.codigo, idPersona: p.id_persona, huellaEnrolada: !!dto.huella, mensaje: 'Cliente registrado correctamente' };
      });
    } catch (e: any) {
      if (e?.code === '23505') throw new ErrorNegocio('DUPLICADO', 'Ya existe una persona con ese correo o teléfono', 409);
      throw e;
    }
  }

  /** SF-01 buscar clientes. */
  async buscarClientes(q?: string, estatus?: string) {
    const params: unknown[] = [];
    const filtros: string[] = [];
    if (q?.trim()) {
      params.push(`%${q.trim()}%`);
      filtros.push(`(p.codigo ILIKE $1 OR p.telefono ILIKE $1 OR p.correo ILIKE $1
        OR (p.nombres || ' ' || p.apellido_paterno || ' ' || coalesce(p.apellido_materno,'')) ILIKE $1)`);
    }
    if (estatus === 'ACTIVO' || estatus === 'INACTIVO') {
      params.push(estatus);
      filtros.push(`c.estatus = $${params.length}`);
    }
    return this.ds.query(
      `SELECT p.codigo, p.nombres, p.apellido_paterno AS "apellidoPaterno", p.apellido_materno AS "apellidoMaterno",
              p.telefono, p.correo, c.estatus, c.conducta,
              EXISTS(SELECT 1 FROM plantilla_biometrica pb WHERE pb.id_persona = p.id_persona) AS "huellaEnrolada"
         FROM cliente c JOIN persona p USING (id_persona)
        ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
        ORDER BY p.apellido_paterno, p.nombres LIMIT 200`, params);
  }
}
