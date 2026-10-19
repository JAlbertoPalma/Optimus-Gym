import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ErrorNegocio } from './errores';

/** PROVISIONAL: actúa como el usuario USUARIO_DEMO hasta implementar login con JWT (CU-01, Etapa 1). */
@Injectable()
export class SesionDemoService {
  private id?: number;
  constructor(private readonly ds: DataSource) {}
  async idEmpleadoActual(): Promise<number> {
    if (this.id) return this.id;
    const r = await this.ds.query('SELECT id_persona FROM empleado WHERE nombre_usuario = $1', [process.env.USUARIO_DEMO ?? 'admin']);
    if (!r.length) throw new ErrorNegocio('SIN_SESION', 'No existe el usuario demo. Ejecuta npm run db:semilla', 500);
    return (this.id = r[0].id_persona);
  }
}
