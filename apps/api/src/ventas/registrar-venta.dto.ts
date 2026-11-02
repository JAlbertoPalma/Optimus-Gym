// DTOs del CU-04 Registrar venta de membresía (los valida ValidationPipe de main.ts).
// Ojo: el navegador NUNCA manda precios ni descuentos para cobrar; solo QUÉ plan y QUÉ promoción.
// El importe lo calcula ventas.service.ts. "totalEsperado" solo sirve para detectar que el
// precio cambió entre que se mostró en pantalla y se confirmó el cobro.
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

// Coinciden con el CHECK de pago.metodo_pago (migración 0001)
export const METODOS_PAGO = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// POST /ventas/cotizar → calcula el resumen del cobro sin guardar nada.
export class CotizarVentaDto {
  @IsOptional() @Transform(recortar) @IsString() @MaxLength(12) codigoCliente?: string;
  @IsInt({ message: 'Selecciona un plan' }) @Min(1, { message: 'Selecciona un plan' }) idTipo: number;
  @IsOptional() @IsInt() @Min(1) idPromocion?: number;
}

// POST /ventas → registra la venta (cobro + membresía).
export class RegistrarVentaDto {
  /** La genera el navegador una vez por operación; el mismo valor en un reintento NO duplica la venta. */
  @IsUUID('all', { message: 'Clave de operación inválida' }) claveIdempotencia: string;
  @Transform(recortar) @IsString() @IsNotEmpty({ message: 'Selecciona un cliente' }) @MaxLength(12) codigoCliente: string;
  @IsInt({ message: 'Selecciona un plan' }) @Min(1, { message: 'Selecciona un plan' }) idTipo: number;
  @IsOptional() @IsInt() @Min(1) idPromocion?: number;
  /** Qué documento revisó recepción (obligatorio si la promoción lo exige). */
  @IsOptional() @Transform(recortar) @IsString() @MaxLength(250) verificacionRequisito?: string;
  @IsIn(METODOS_PAGO, { message: 'Método de pago no válido' }) metodoPago: MetodoPago;
  /** Efectivo entregado por el cliente (solo EFECTIVO). */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El importe recibido debe ser un número con máximo 2 decimales' })
  @Min(0, { message: 'El importe recibido no puede ser negativo' }) @Max(1_000_000, { message: 'Importe recibido fuera de rango' })
  importeRecibido?: number;
  /** Número de autorización del voucher o clave de rastreo de la transferencia. */
  @IsOptional() @Transform(recortar) @IsString() @MaxLength(60) referenciaPago?: string;
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Total esperado inválido' }) @Min(0) totalEsperado: number;
}
