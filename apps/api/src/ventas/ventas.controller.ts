// CONTROLADOR DE VENTAS (CU-04 Registrar venta de membresía). Sin reglas de negocio: todo está en ventas.service.ts.
// Ruta completa = /api/v1 (main.ts) + 'ventas'. Las rutas fijas van antes de ':folio' para que no las capture.
import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CotizarVentaDto, RegistrarVentaDto } from './registrar-venta.dto';
import { VentasService } from './ventas.service';

@Controller('ventas')
export class VentasController {
  constructor(private readonly svc: VentasService) {}

  // GET /api/v1/ventas/catalogo → planes activos (precios desde la BD) y métodos de pago.
  @Get('catalogo')
  catalogo() {
    return this.svc.catalogo();
  }

  // GET /api/v1/ventas/clientes/:codigo → datos del cliente, membresía vigente y estado de acceso.
  @Get('clientes/:codigo')
  estadoCliente(@Param('codigo') codigo: string) {
    return this.svc.estadoCliente(codigo);
  }

  // POST /api/v1/ventas/cotizar → resumen del cobro calculado en el servidor (no guarda nada).
  @Post('cotizar')
  @HttpCode(200)
  cotizar(@Body() dto: CotizarVentaDto) {
    return this.svc.cotizar(dto);
  }

  // POST /api/v1/ventas → registra la venta. 201 si es nueva; 200 si la clave ya estaba registrada (reintento).
  @Post()
  async registrar(@Body() dto: RegistrarVentaDto, @Res({ passthrough: true }) res: Response) {
    const r = await this.svc.registrar(dto);
    res.status(r.duplicada ? 200 : 201);
    return r;
  }

  // GET /api/v1/ventas/:folio → recibo de una venta registrada (reimpresión).
  @Get(':folio')
  recibo(@Param('folio') folio: string) {
    return this.svc.recibo(folio);
  }
}
