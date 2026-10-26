// CONTROLADOR: define las rutas HTTP y le pasa el trabajo al servicio.
// No contiene reglas de negocio; solo recibe la petición y regresa lo que responda el servicio.
// Ruta completa = prefijo de main.ts (/api/v1) + este decorador ('clientes') = /api/v1/clientes
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { ActualizarClienteDto, DarDeBajaDto } from './gestionar-cliente.dto';
import { HuellaDto, RegistrarClienteDto } from './registrar-cliente.dto';

@Controller('clientes')
export class ClientesController {
  // NestJS inyecta el servicio automáticamente (ver clientes.module.ts)
  constructor(private readonly svc: ClientesService) {}

  // POST /api/v1/clientes → alta (FB-01). Cuando llega aquí, ValidationPipe (main.ts) ya validó el DTO.
  @Post()
  @HttpCode(201)
  registrar(@Body() dto: RegistrarClienteDto) {
    return this.svc.registrarCliente(dto);
  }

  // GET /api/v1/clientes?q=texto&estatus=ACTIVO → lista y búsqueda (SF-01).
  @Get()
  buscar(@Query('q') q?: string, @Query('estatus') estatus?: string) {
    return this.svc.buscarClientes(q, estatus);
  }

  // GET /api/v1/clientes/:codigo → ficha del cliente (datos, contacto, huellas activas).
  @Get(':codigo')
  ficha(@Param('codigo') codigo: string) {
    return this.svc.obtenerFicha(codigo);
  }

  // PATCH /api/v1/clientes/:codigo → editar datos (SF-02). Solo actualiza lo enviado.
  @Patch(':codigo')
  actualizar(@Param('codigo') codigo: string, @Body() dto: ActualizarClienteDto) {
    return this.svc.actualizarCliente(codigo, dto);
  }

  // POST /api/v1/clientes/:codigo/huella → enrolar o reenrolar huella (SF-03 / FA-04).
  @Post(':codigo/huella')
  @HttpCode(201)
  enrolar(@Param('codigo') codigo: string, @Body() dto: HuellaDto) {
    return this.svc.enrolarHuella(codigo, dto);
  }

  // POST /api/v1/clientes/:codigo/baja → baja lógica (SF-04); exige motivo.
  @Post(':codigo/baja')
  @HttpCode(200)
  baja(@Param('codigo') codigo: string, @Body() dto: DarDeBajaDto) {
    return this.svc.darDeBaja(codigo, dto);
  }

  // POST /api/v1/clientes/:codigo/reactivar → reactivar (SF-04).
  @Post(':codigo/reactivar')
  @HttpCode(200)
  reactivar(@Param('codigo') codigo: string) {
    return this.svc.reactivar(codigo);
  }
}
