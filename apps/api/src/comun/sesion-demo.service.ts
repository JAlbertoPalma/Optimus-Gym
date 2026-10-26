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
}
