// MÓDULO DE VENTAS (CU-04 Registrar venta de membresía). Lo importa app.module.ts.
import { Module } from '@nestjs/common';
import { SesionDemoService } from '../comun/sesion-demo.service';
import { VentasController } from './ventas.controller';
import { VentasService } from './ventas.service';

@Module({
  controllers: [VentasController],
  providers: [VentasService, SesionDemoService],
})
export class VentasModule {}
