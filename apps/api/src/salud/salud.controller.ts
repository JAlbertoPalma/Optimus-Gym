// GET /health: indica si la API está encendida y conectada a la base de datos.
// Está registrado en app.module.ts y queda fuera del prefijo /api/v1 (ver main.ts).
// Lo usa la primera prueba de test/humo.ts.
import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller('health')
export class SaludController {
  constructor(private readonly ds: DataSource) {}
  @Get()
  async estado() {
    // Consulta mínima: si la BD no responde, lanza un error y FiltroErrores responde 500
    await this.ds.query('SELECT 1');
    return { estado: 'ok', baseDeDatos: 'conectada', hora: new Date().toISOString() };
  }
}
