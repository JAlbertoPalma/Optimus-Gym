import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller('health')
export class SaludController {
  constructor(private readonly ds: DataSource) {}
  @Get()
  async estado() {
    await this.ds.query('SELECT 1');
    return { estado: 'ok', baseDeDatos: 'conectada', hora: new Date().toISOString() };
  }
}
