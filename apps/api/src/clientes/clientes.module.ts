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
