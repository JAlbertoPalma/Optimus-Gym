// CONTROLADOR: define las rutas HTTP y le pasa el trabajo al servicio.
// No contiene reglas de negocio; solo recibe la petición y regresa lo que responda el servicio.
// Ruta completa = prefijo de main.ts (/api/v1) + este decorador ('clientes') = /api/v1/clientes
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { RegistrarClienteDto } from './registrar-cliente.dto';

@Controller('clientes')
export class ClientesController {
  // NestJS inyecta el servicio automáticamente (ver clientes.module.ts)
  constructor(private readonly svc: ClientesService) {}

  // POST /api/v1/clientes → lo llama registrarCliente() de index.html.
  // @Body() toma el JSON enviado. Cuando llega aquí, ValidationPipe (main.ts) ya lo validó con RegistrarClienteDto.
  // Lo que regrese el servicio se envía como JSON con estado 201 (Created).
  @Post()
  @HttpCode(201)
  registrar(@Body() dto: RegistrarClienteDto) {
    return this.svc.registrarCliente(dto);
  }

  // GET /api/v1/clientes?q=texto&estatus=ACTIVO → lo llama cargarClientes() de index.html.
  // @Query() lee los parámetros que vienen en la URL después del "?".
  @Get()
  buscar(@Query('q') q?: string, @Query('estatus') estatus?: string) {
    return this.svc.buscarClientes(q, estatus);
  }
}
