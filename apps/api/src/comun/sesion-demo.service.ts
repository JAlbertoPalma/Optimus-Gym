import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ErrorNegocio } from './errores';

/** PROVISIONAL: actúa como el usuario USUARIO_DEMO hasta implementar login con JWT. */
// Como todavía no hay login, todas las operaciones se registran como si las hiciera el empleado
// "admin" (creado por db/semilla.ts). clientes.service.ts lo usa para llenar la bitácora de auditoría.
@Injectable()
export class SesionDemoService {
  private id?: number; // se guarda después de la primera consulta para no repetirla
  constructor(private readonly ds: DataSource) {}

  async idEmpleadoActual(): Promise<number> {
    if (this.id) return this.id;
    const r = await this.ds.query('SELECT id_persona FROM empleado WHERE nombre_usuario = $1', [process.env.USUARIO_DEMO ?? 'admin']);
    if (!r.length) throw new ErrorNegocio('SIN_SESION', 'No existe el usuario demo. Ejecuta npm run db:semilla', 500);
    return (this.id = r[0].id_persona); // asigna y regresa el valor en una sola línea
  }

  /** Autorización: devuelve el id del empleado actual si está ACTIVO y tiene alguno de los roles; si no, 403.
   *  Los roles se consultan siempre (sin caché) para que una baja o un cambio de rol aplique de inmediato. */
  async exigirRol(...roles: string[]): Promise<number> {
    const id = await this.idEmpleadoActual();
    const [r] = await this.ds.query(
      `SELECT EXISTS(SELECT 1 FROM empleado e JOIN empleado_rol er USING (id_persona) JOIN rol r USING (id_rol)
                      WHERE e.id_persona = $1 AND e.estatus = 'ACTIVO' AND r.nombre = ANY($2)) AS autorizado`, [id, roles]);
    if (!r.autorizado) throw new ErrorNegocio('SIN_PERMISO', `Esta operación requiere el rol: ${roles.join(' o ')}`, 403);
    return id;
  }
}
