import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { RegistrarClienteDto } from './registrar-cliente.dto';

@Controller('clientes')
export class ClientesController {
  constructor(private readonly svc: ClientesService) {}
  @Post() @HttpCode(201) registrar(@Body() dto: RegistrarClienteDto) { return this.svc.registrarCliente(dto); }
  @Get() buscar(@Query('q') q?: string, @Query('estatus') estatus?: string) { return this.svc.buscarClientes(q, estatus); }
}
