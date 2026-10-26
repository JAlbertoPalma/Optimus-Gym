// SERVICIO DE CLIENTES: aquí viven las reglas de negocio del CU-02.
// Lo llama clientes.controller.ts. Habla con PostgreSQL usando SQL directo a través de DataSource.
// Los códigos FB-xx / FA-xx / RE-xx / SF-xx vienen del documento del caso de uso:
//   FB = flujo básico, FA = flujo alterno, RE = requerimiento especial, SF = subflujo.
//
// En las consultas, $1, $2… son "parámetros": PostgreSQL los reemplaza por los valores del arreglo.
// Nunca se pegan los datos del usuario directo en el texto del SQL; así se evita la inyección SQL.
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CifradoService } from '../comun/cifrado.service';
import { ErrorNegocio } from '../comun/errores';
import { SesionDemoService } from '../comun/sesion-demo.service';
import { CALIDAD_MINIMA, ComparadorHuellasService, UMBRAL_DUPLICADO } from '../huellas/comparador-huellas.service';
import { ActualizarClienteDto, DarDeBajaDto } from './gestionar-cliente.dto';
import { HuellaDto, RegistrarClienteDto } from './registrar-cliente.dto';

@Injectable()
export class ClientesService {
  // Todas estas dependencias las inyecta NestJS (ver clientes.module.ts y app.module.ts)
  constructor(
    private readonly ds: DataSource, // conexión a la BD (configurada en app.module.ts)
    private readonly cifrado: CifradoService, // comun/cifrado.service.ts
    private readonly comparador: ComparadorHuellasService, // huellas/comparador-huellas.service.ts
    private readonly sesion: SesionDemoService, // comun/sesion-demo.service.ts
  ) {}

  /** OP-CU02-01 registrarCliente (FB-01 y flujos alternativos FA-01, FA-02, FA-05, FA-06, FA-08). */
  // Orden: primero todas las validaciones (si una falla se lanza un error y se detiene todo),
  // y al final, solo si todo pasó, se guarda en la base de datos.
  async registrarCliente(dto: RegistrarClienteDto) {
    // Empleado que hace el registro; se guarda en la bitácora de auditoría
    const idEmpleado = await this.sesion.idEmpleadoActual();

    // FA-06: reglas de datos (el formato ya lo validó el DTO; aquí se revisa que no sea fecha futura)
    const nac = new Date(dto.fechaNacimiento);
    if (isNaN(nac.getTime()) || nac > new Date())
      throw new ErrorNegocio('DATOS_INVALIDOS', 'La fecha de nacimiento no es válida', 422, { fechaNacimiento: 'No puede ser futura' });

    if(nac.getFullYear() <= 1800)
      throw new ErrorNegocio('DATOS INVALIDOS', 'La fecha de nacimiento no es válida', 422, {fechaNacimiento: 'Nadie tiene más de 200 años...'})
    
    // FA-08: alta sin huella exige motivo
    if (!dto.huella && !dto.observacionesAcceso?.trim())
      throw new ErrorNegocio('MOTIVO_REQUERIDO', 'Sin huella, debes registrar el motivo en Observaciones de acceso', 422,
        { observacionesAcceso: 'Obligatorio cuando no se enrola huella' });

    // FA-02: calidad mínima (valor de CALIDAD_MINIMA en .env, 70 por defecto)
    let plantilla: Buffer | undefined; // Buffer = arreglo de bytes en Node.js
    if (dto.huella) {
      if (dto.huella.calidad < CALIDAD_MINIMA())
        throw new ErrorNegocio('CALIDAD_INSUFICIENTE', `La calidad de la huella (${dto.huella.calidad}) es menor a ${CALIDAD_MINIMA()}. Vuelve a capturar.`, 422);
      // Convierte el texto Base64 que mandó index.html de vuelta a bytes
      plantilla = Buffer.from(dto.huella.plantillaBase64, 'base64');
      if (!plantilla.length) throw new ErrorNegocio('DATOS_INVALIDOS', 'Plantilla de huella vacía', 422);
    }

    // FA-01: correo o teléfono ya registrados.
    // Busca en "persona" y además revisa si esa persona ya es cliente y/o empleado.
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

    // FA-05: huella duplicada (búsqueda 1:N contra plantillas existentes).
    // "1:N" = se compara la huella nueva contra TODAS las guardadas. Como en la BD están cifradas,
    // primero se descifra cada una y luego se mide qué tan parecida es (0 a 100).
    let enc: { cifrado: Buffer; iv: Buffer } | undefined;
    if (plantilla) {
      const todas = await this.ds.query(
        `SELECT pb.plantilla_cifrada, pb.vector_inicializacion, p.codigo
           FROM plantilla_biometrica pb JOIN persona p USING (id_persona)
          WHERE pb.activa = true`);
      for (const t of todas) {
        const sim = this.comparador.similitud(plantilla, this.cifrado.descifrar(t.plantilla_cifrada, t.vector_inicializacion));
        if (sim >= UMBRAL_DUPLICADO())
          throw new ErrorNegocio('HUELLA_DUPLICADA', 'Esta huella ya está enrolada en otra persona', 409, undefined,
            { codigoExistente: t.codigo, similitud: Math.round(sim) });
      }
      enc = this.cifrado.cifrar(plantilla); // RE-02: la huella nunca se guarda sin cifrar
    }

    // RE-05: transacción atómica.
    // Todos los INSERT se hacen juntos: si cualquiera falla, PostgreSQL deshace todos (ROLLBACK)
    // y no quedan datos a medias (por ejemplo, una persona sin su registro de cliente).
    // Dentro de la transacción se usa "m" (el manejador de la transacción) en lugar de "this.ds".
    try {
      return await this.ds.transaction(async (m) => {
        // 1) Persona: datos generales. RETURNING devuelve el id y el código "OG-00001" que generó la BD.
        const [p] = await m.query(
          `INSERT INTO persona (nombres, apellido_paterno, apellido_materno, fecha_nacimiento, sexo, telefono, correo)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id_persona, codigo`,
          [dto.nombres.trim(), dto.apellidoPaterno.trim(), dto.apellidoMaterno?.trim() || null,
           dto.fechaNacimiento, dto.sexo, dto.telefono, dto.correo.trim()]);
        
        // 2) Cliente: marca a esa persona como cliente del gimnasio
        await m.query('INSERT INTO cliente (id_persona, observaciones_acceso) VALUES ($1,$2)', [p.id_persona, dto.observacionesAcceso?.trim() || null]);
        
        // 3) Contacto de emergencia
        await m.query('INSERT INTO contacto_emergencia (id_persona, nombre, telefono, parentesco) VALUES ($1,$2,$3,$4)',
          [p.id_persona, dto.contactoEmergencia.nombre, dto.contactoEmergencia.telefono, dto.contactoEmergencia.parentesco ?? null]);
        
        // 4) Huella cifrada (solo si se capturó)
        if (enc && dto.huella) {
          await m.query(
            `INSERT INTO plantilla_biometrica (id_persona, dedo, plantilla_cifrada, vector_inicializacion, calidad, formato_plantilla, version_sdk)
             VALUES ($1,$2,$3,$4,$5,'SIMULADO','0')`,
            [p.id_persona, dto.huella.dedo, enc.cifrado, enc.iv, dto.huella.calidad]);
        }
        
        // 5) Bitácora: quién dio de alta a quién, y el motivo si fue sin huella
        await m.query(
          `INSERT INTO registro_auditoria (id_empleado, id_persona, accion, motivo, entidad_afectada, id_registro_afectado)
           VALUES ($1,$2,$3,$4,'cliente',$2)`,
          [idEmpleado, p.id_persona, dto.huella ? 'ALTA_CLIENTE' : 'ALTA_CLIENTE_SIN_HUELLA', dto.huella ? null : dto.observacionesAcceso]);
        // Esto es lo que recibe index.html como datosRespuesta cuando el registro sale bien
        return { codigo: p.codigo, idPersona: p.id_persona, huellaEnrolada: !!dto.huella, mensaje: 'Cliente registrado correctamente' };
      });
    } catch (e: any) {
      // 23505 = código de PostgreSQL para "valor repetido en un campo UNIQUE".
      // Pasa si dos registros con el mismo correo/teléfono llegan casi al mismo tiempo y ambos pasan FA-01.
      if (e?.code === '23505') throw new ErrorNegocio('DUPLICADO', 'Ya existe una persona con ese correo o teléfono', 409);
      throw e;
    }
  }

  /** SF-01 buscar clientes. */
  // Arma el WHERE de forma dinámica: solo agrega los filtros que sí vienen en la petición.
  async buscarClientes(q?: string, estatus?: string) {
    const params: unknown[] = []; // valores para $1, $2…
    const filtros: string[] = []; // condiciones que se unirán con AND
    if (q?.trim()) {
      // ILIKE = LIKE sin distinguir mayúsculas; los % significan "cualquier texto antes/después"
      params.push(`%${q.trim()}%`);
      filtros.push(`(p.codigo ILIKE $1 OR p.telefono ILIKE $1 OR p.correo ILIKE $1
        OR (p.nombres || ' ' || p.apellido_paterno || ' ' || coalesce(p.apellido_materno,'')) ILIKE $1)`);
    }
    if (estatus === 'ACTIVO' || estatus === 'INACTIVO') {
      params.push(estatus);
      filtros.push(`c.estatus = $${params.length}`); // será $1 o $2 según si hubo búsqueda de texto
    }
    // Los alias entre comillas ("apellidoPaterno") hacen que el JSON use los nombres que espera index.html
    return this.ds.query(
      `SELECT p.codigo, p.nombres, p.apellido_paterno AS "apellidoPaterno", p.apellido_materno AS "apellidoMaterno",
              p.telefono, p.correo, c.estatus, c.conducta,
              EXISTS(SELECT 1 FROM plantilla_biometrica pb WHERE pb.id_persona = p.id_persona AND pb.activa = true) AS "huellaEnrolada"
         FROM cliente c JOIN persona p USING (id_persona)
        ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
        ORDER BY p.apellido_paterno, p.nombres LIMIT 200`, params);
  }

  /** Carga un cliente por su código visible (OG-00001). Lanza 404 si no existe.
   *  Acepta el manejador de una transacción (m) para usarse dentro de ella. */
  private async cargarCliente(codigo: string, m: DataSource | EntityManager = this.ds) {
    const [row] = await m.query(
      `SELECT p.id_persona, p.codigo, p.nombres, p.apellido_paterno, p.apellido_materno,
              to_char(p.fecha_nacimiento,'YYYY-MM-DD') AS fecha_nacimiento, p.sexo,
              p.telefono, p.correo, p.direccion,
              c.estatus, c.observaciones_acceso, c.conducta,
              c.fecha_alta AS "fechaAlta", c.fecha_baja AS "fechaBaja", c.motivo_baja AS "motivoBaja"
         FROM cliente c JOIN persona p USING (id_persona)
        WHERE p.codigo = $1`, [codigo]);
    if (!row) throw new ErrorNegocio('NO_ENCONTRADO', 'No existe un cliente con ese código', 404);
    return row;
  }

  /** Ficha del cliente: datos, contacto y huellas ACTIVAS. Nunca devuelve la plantilla. */
  async obtenerFicha(codigo: string) {
    const c = await this.cargarCliente(codigo);
    const [contacto] = await this.ds.query(
      'SELECT nombre, telefono, parentesco FROM contacto_emergencia WHERE id_persona = $1', [c.id_persona]);
    // Solo dedo/calidad/fecha: la plantilla cifrada JAMÁS sale de la base de datos
    const huellas = await this.ds.query(
      `SELECT dedo, calidad, fecha_enrolamiento AS "fechaEnrolamiento"
         FROM plantilla_biometrica WHERE id_persona = $1 AND activa = true ORDER BY dedo`, [c.id_persona]);
    return {
      codigo: c.codigo, nombres: c.nombres,
      apellidoPaterno: c.apellido_paterno, apellidoMaterno: c.apellido_materno,
      fechaNacimiento: c.fecha_nacimiento, sexo: c.sexo, telefono: c.telefono, correo: c.correo,
      direccion: c.direccion, estatus: c.estatus, conducta: c.conducta,
      observacionesAcceso: c.observaciones_acceso,
      fechaAlta: c.fechaAlta, fechaBaja: c.fechaBaja, motivoBaja: c.motivoBaja,
      contactoEmergencia: contacto ?? null,
      huellas,
    };
  }

  /** SF-02 editar datos. Solo toca lo enviado; si nada cambia → 422 SIN_CAMBIOS.
   *  Audita por NOMBRES de los campos modificados, nunca por sus valores. */
  async actualizarCliente(codigo: string, dto: ActualizarClienteDto) {
    const idEmpleado = await this.sesion.idEmpleadoActual();
    const c = await this.cargarCliente(codigo);
    if (c.estatus === 'INACTIVO')
      throw new ErrorNegocio('CLIENTE_INACTIVO', 'No se puede editar un cliente inactivo; reactívalo primero', 409);

    // FA-06: la fecha de nacimiento (si viene) no puede ser futura ni absurda
    if (dto.fechaNacimiento !== undefined) {
      const nac = new Date(dto.fechaNacimiento);
      if (isNaN(nac.getTime()) || nac > new Date())
        throw new ErrorNegocio('DATOS_INVALIDOS', 'La fecha de nacimiento no es válida', 422, { fechaNacimiento: 'No puede ser futura' });
      if (nac.getFullYear() <= 1800)
        throw new ErrorNegocio('DATOS_INVALIDOS', 'La fecha de nacimiento no es válida', 422, { fechaNacimiento: 'Nadie tiene más de 200 años...' });
    }

    // Normaliza: trim a textos y trata '' como null (sin valor)
    const norm = (v: any) => {
      const t = typeof v === 'string' ? v.trim() : v;
      return t === '' || t === undefined ? null : t;
    };

    // 1) Detecta QUÉ cambió: solo campos enviados y con valor distinto al actual.
    const cambiosPersona: Record<string, any> = {}; // columna -> valor nuevo
    const camposAuditados: string[] = [];           // nombres de campo (para la bitácora)
    const comparar = (campo: string, columna: string, valorNuevo: any, valorActual: any) => {
      if (valorNuevo === undefined) return;
      if (norm(valorNuevo) === norm(valorActual)) return;
      cambiosPersona[columna] = norm(valorNuevo);
      camposAuditados.push(campo);
    };
    comparar('nombres', 'nombres', dto.nombres, c.nombres);
    comparar('apellidoPaterno', 'apellido_paterno', dto.apellidoPaterno, c.apellido_paterno);
    comparar('apellidoMaterno', 'apellido_materno', dto.apellidoMaterno, c.apellido_materno);
    comparar('fechaNacimiento', 'fecha_nacimiento', dto.fechaNacimiento, c.fecha_nacimiento);
    comparar('sexo', 'sexo', dto.sexo, c.sexo);
    comparar('telefono', 'telefono', dto.telefono, c.telefono);
    comparar('correo', 'correo', dto.correo, c.correo);
    comparar('direccion', 'direccion', dto.direccion, c.direccion);

    // observaciones_acceso está en la tabla cliente, no en persona
    let nuevaObs = c.observaciones_acceso;
    let cambiaObs = false;
    if (dto.observacionesAcceso !== undefined && norm(dto.observacionesAcceso) !== norm(c.observaciones_acceso)) {
      nuevaObs = norm(dto.observacionesAcceso);
      cambiaObs = true;
      camposAuditados.push('observacionesAcceso');
    }

    // contacto de emergencia (cada subcampo por separado)
    const cambiosContacto: Record<string, any> = {};
    if (dto.contactoEmergencia) {
      const [ce] = await this.ds.query('SELECT nombre, telefono, parentesco FROM contacto_emergencia WHERE id_persona = $1', [c.id_persona]);
      const cmpCE = (campo: string, columna: string, nuevo: any, actual: any) => {
        if (nuevo === undefined) return;
        if (norm(nuevo) === norm(actual)) return;
        cambiosContacto[columna] = norm(nuevo);
        camposAuditados.push('contactoEmergencia.' + campo);
      };
      cmpCE('nombre', 'nombre', dto.contactoEmergencia.nombre, ce?.nombre);
      cmpCE('telefono', 'telefono', dto.contactoEmergencia.telefono, ce?.telefono);
      cmpCE('parentesco', 'parentesco', dto.contactoEmergencia.parentesco, ce?.parentesco);
    }

    // 2) ¿No cambió nada? → 422 SIN_CAMBIOS
    if (!camposAuditados.length)
      throw new ErrorNegocio('SIN_CAMBIOS', 'No se detectaron cambios para guardar', 422);

    // FA-08: sin huella activa, las observaciones de acceso siguen siendo obligatorias
    const [{ tiene }] = await this.ds.query(
      'SELECT EXISTS(SELECT 1 FROM plantilla_biometrica WHERE id_persona=$1 AND activa=true) AS tiene', [c.id_persona]);
    if (!tiene && !(nuevaObs && String(nuevaObs).trim()))
      throw new ErrorNegocio('MOTIVO_REQUERIDO', 'Sin huella activa, debes mantener el motivo en Observaciones de acceso', 422,
        { observacionesAcceso: 'Obligatorio cuando no hay huella activa' });

    // FA-01: correo/teléfono duplicados contra OTRAS personas
    if (cambiosPersona.correo != null || cambiosPersona.telefono != null) {
      const dup = await this.ds.query(
        `SELECT codigo FROM persona
          WHERE id_persona <> $1 AND (($2::text IS NOT NULL AND lower(correo)=lower($2)) OR ($3::text IS NOT NULL AND telefono=$3))`,
        [c.id_persona, cambiosPersona.correo ?? null, cambiosPersona.telefono ?? null]);
      if (dup.length) throw new ErrorNegocio('DUPLICADO', 'Ya existe otra persona con ese correo o teléfono', 409, undefined, { codigoExistente: dup[0].codigo });
    }

    // 3) Aplica los cambios en una transacción. Los nombres de columna son fijos (no vienen del usuario).
    try {
      await this.ds.transaction(async (m) => {
        const cols = Object.keys(cambiosPersona);
        if (cols.length) {
          const sets = cols.map((col, i) => `${col} = $${i + 2}`).join(', ');
          await m.query(`UPDATE persona SET ${sets} WHERE id_persona = $1`, [c.id_persona, ...cols.map((col) => cambiosPersona[col])]);
        }
        if (cambiaObs)
          await m.query('UPDATE cliente SET observaciones_acceso = $2 WHERE id_persona = $1', [c.id_persona, nuevaObs]);
        const colsCE = Object.keys(cambiosContacto);
        if (colsCE.length) {
          const sets = colsCE.map((col, i) => `${col} = $${i + 2}`).join(', ');
          await m.query(`UPDATE contacto_emergencia SET ${sets} WHERE id_persona = $1`, [c.id_persona, ...colsCE.map((col) => cambiosContacto[col])]);
        }
        await m.query(
          `INSERT INTO registro_auditoria (id_empleado, id_persona, accion, detalle, entidad_afectada, id_registro_afectado)
           VALUES ($1,$2,'MODIFICACION_CLIENTE',$3,'cliente',$2)`,
          [idEmpleado, c.id_persona, camposAuditados.join(', ')]);
      });
    } catch (e: any) {
      if (e?.code === '23505') throw new ErrorNegocio('DUPLICADO', 'Ya existe otra persona con ese correo o teléfono', 409);
      throw e;
    }
    return { codigo: c.codigo, camposActualizados: camposAuditados, mensaje: 'Datos actualizados correctamente' };
  }

  /** SF-03 enrolar/reenrolar huella (también FA-04: enrolar a quien se dio de alta sin huella).
   *  Desactiva la plantilla anterior del mismo dedo e inserta la nueva, todo en una transacción. */
  async enrolarHuella(codigo: string, dto: HuellaDto) {
    const idEmpleado = await this.sesion.idEmpleadoActual();
    const c = await this.cargarCliente(codigo);
    if (c.estatus === 'INACTIVO')
      throw new ErrorNegocio('CLIENTE_INACTIVO', 'No se puede enrolar la huella de un cliente inactivo; reactívalo primero', 409);

    // FA-02: calidad mínima
    if (dto.calidad < CALIDAD_MINIMA())
      throw new ErrorNegocio('CALIDAD_INSUFICIENTE', `La calidad de la huella (${dto.calidad}) es menor a ${CALIDAD_MINIMA()}. Vuelve a capturar.`, 422);

    const plantilla = Buffer.from(dto.plantillaBase64, 'base64');
    if (!plantilla.length) throw new ErrorNegocio('DATOS_INVALIDOS', 'Plantilla de huella vacía', 422);

    // FA-05: huella duplicada contra plantillas ACTIVAS de OTRAS personas
    const otras = await this.ds.query(
      `SELECT pb.plantilla_cifrada, pb.vector_inicializacion, p.codigo
         FROM plantilla_biometrica pb JOIN persona p USING (id_persona)
        WHERE pb.activa = true AND pb.id_persona <> $1`, [c.id_persona]);
    for (const t of otras) {
      const sim = this.comparador.similitud(plantilla, this.cifrado.descifrar(t.plantilla_cifrada, t.vector_inicializacion));
      if (sim >= UMBRAL_DUPLICADO())
        throw new ErrorNegocio('HUELLA_DUPLICADA', 'Esta huella ya está enrolada en otra persona', 409, undefined,
          { codigoExistente: t.codigo, similitud: Math.round(sim) });
    }

    const enc = this.cifrado.cifrar(plantilla); // RE-02: nunca se guarda sin cifrar
    const reenrolado = await this.ds.transaction(async (m) => {
      // ¿Ya existía plantilla activa de ese dedo? → es reenrolamiento: se desactiva la anterior
      const prev = await m.query('SELECT id_plantilla FROM plantilla_biometrica WHERE id_persona=$1 AND dedo=$2 AND activa=true', [c.id_persona, dto.dedo]);
      const esRe = prev.length > 0;
      if (esRe) await m.query('UPDATE plantilla_biometrica SET activa=false WHERE id_plantilla=$1', [prev[0].id_plantilla]);
      const [ins] = await m.query(
        `INSERT INTO plantilla_biometrica (id_persona, dedo, plantilla_cifrada, vector_inicializacion, calidad, formato_plantilla, version_sdk, activa)
         VALUES ($1,$2,$3,$4,$5,'SIMULADO','0',true) RETURNING id_plantilla`,
        [c.id_persona, dto.dedo, enc.cifrado, enc.iv, dto.calidad]);
      await m.query(
        `INSERT INTO registro_auditoria (id_empleado, id_persona, accion, detalle, entidad_afectada, id_registro_afectado)
         VALUES ($1,$2,$3,$4,'plantilla_biometrica',$5)`,
        [idEmpleado, c.id_persona, esRe ? 'REENROLAMIENTO_HUELLA' : 'ENROLAMIENTO_HUELLA', `dedo ${dto.dedo}, calidad ${dto.calidad}`, ins.id_plantilla]);
      return esRe;
    });
    return { codigo: c.codigo, dedo: dto.dedo, calidad: dto.calidad, reenrolado,
      mensaje: reenrolado ? 'Huella reenrolada correctamente' : 'Huella enrolada correctamente' };
  }

  /** SF-04 dar de baja (lógica): estatus INACTIVO con fecha y motivo. */
  async darDeBaja(codigo: string, dto: DarDeBajaDto) {
    const idEmpleado = await this.sesion.idEmpleadoActual();
    const c = await this.cargarCliente(codigo);
    if (c.estatus === 'INACTIVO') throw new ErrorNegocio('YA_INACTIVO', 'El cliente ya está inactivo', 409);
    await this.ds.transaction(async (m) => {
      await m.query(`UPDATE cliente SET estatus='INACTIVO', fecha_baja=CURRENT_TIMESTAMP, motivo_baja=$2 WHERE id_persona=$1`,
        [c.id_persona, dto.motivo.trim()]);
      await m.query(
        `INSERT INTO registro_auditoria (id_empleado, id_persona, accion, motivo, entidad_afectada, id_registro_afectado)
         VALUES ($1,$2,'BAJA_CLIENTE',$3,'cliente',$2)`, [idEmpleado, c.id_persona, dto.motivo.trim()]);
    });
    return { codigo: c.codigo, estatus: 'INACTIVO', mensaje: 'Cliente dado de baja correctamente' };
  }

  /** SF-04 reactivar: estatus ACTIVO; limpia fecha_baja y motivo_baja. */
  async reactivar(codigo: string) {
    const idEmpleado = await this.sesion.idEmpleadoActual();
    const c = await this.cargarCliente(codigo);
    if (c.estatus === 'ACTIVO') throw new ErrorNegocio('YA_ACTIVO', 'El cliente ya está activo', 409);
    await this.ds.transaction(async (m) => {
      await m.query(`UPDATE cliente SET estatus='ACTIVO', fecha_baja=NULL, motivo_baja=NULL WHERE id_persona=$1`, [c.id_persona]);
      await m.query(
        `INSERT INTO registro_auditoria (id_empleado, id_persona, accion, entidad_afectada, id_registro_afectado)
         VALUES ($1,$2,'REACTIVACION_CLIENTE','cliente',$2)`, [idEmpleado, c.id_persona]);
    });
    return { codigo: c.codigo, estatus: 'ACTIVO', mensaje: 'Cliente reactivado correctamente' };
  }
}
