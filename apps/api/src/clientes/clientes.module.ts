// MÓDULO DE CLIENTES (CU-02 Administrar Clientes). Lo importa app.module.ts.
// Le indica a NestJS qué controlador atiende las rutas y qué servicios (providers) existen.
// NestJS crea una instancia de cada provider y la "inyecta" en los constructores que la piden
// (inyección de dependencias). Por eso ClientesService recibe CifradoService sin hacer "new".
import { Module } from '@nestjs/common';
import { CifradoService } from '../comun/cifrado.service';
import { SesionDemoService } from '../comun/sesion-demo.service';
import { ComparadorHuellasService } from '../huellas/comparador-huellas.service';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';

@Module({
  controllers: [ClientesController],
  providers: [ClientesService, CifradoService, SesionDemoService, ComparadorHuellasService],
})
export class ClientesModule {}
