// DTO (Data Transfer Object): describe la forma que DEBE tener el JSON que envía index.html.
// Los decoradores de class-validator (@IsString, @Matches…) son las reglas de validación.
// ValidationPipe (main.ts) las revisa ANTES de llegar al controlador. Si alguna falla, se responde
// 422 con el mensaje de cada campo y el servicio nunca se ejecuta.
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested, IsDateString } from 'class-validator';

// Quita espacios, paréntesis, puntos y guiones: "(644) 123-4567" → "6441234567".
// Se usa con @Transform para limpiar el teléfono antes de validarlo.
const soloDigitos = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[\s().-]/g, '') : value);

// Corresponde a datosCliente.contactoEmergencia en index.html
export class ContactoEmergenciaDto {
  @IsString() @IsNotEmpty() @MaxLength(120) nombre: string;
  @Transform(soloDigitos)
  @Matches(/^\d{10}$/, { message: 'El teléfono debe tener 10 dígitos' }) telefono: string;
  @IsOptional() @IsString() @MaxLength(40) parentesco?: string;
}

// Corresponde a datosCliente.huella en index.html (lo arma construirHuella())
export class HuellaDto {
  @IsInt() @Min(1) @Max(10) dedo: number; // 1 a 10
  /** Plantilla (minucias) en base64. Nunca la imagen de la huella. */
  @IsString() @IsNotEmpty() plantillaBase64: string;
  // Aquí solo se valida el rango; la calidad mínima aceptada se revisa en clientes.service.ts (FA-02)
  @IsInt() @Min(0) @Max(100) calidad: number;
}

// Objeto principal que recibe POST /api/v1/clientes.
// El "?" marca un campo opcional (siempre va junto con @IsOptional).
export class RegistrarClienteDto {
  @IsString() @IsNotEmpty() @MaxLength(80) nombres: string;
  @IsString() @IsNotEmpty() @MaxLength(60) apellidoPaterno: string;
  @IsOptional() @IsString() @MaxLength(60) apellidoMaterno?: string;
  @IsDateString({}, { message: 'La fecha de nacimiento debe tener formato AAAA-MM-DD' }) fechaNacimiento: string;
  @IsIn(['F', 'M', 'O'], { message: 'El sexo debe ser F, M u O' }) sexo: 'F' | 'M' | 'O';
  @Transform(soloDigitos)
  @Matches(/^\d{10}$/, { message: 'El teléfono debe tener 10 dígitos' }) telefono: string;
  @IsEmail({}, { message: 'Correo con formato inválido' }) correo: string;
  // @ValidateNested + @Type: valida también el objeto interno usando su propio DTO
  @ValidateNested() @Type(() => ContactoEmergenciaDto) contactoEmergencia: ContactoEmergenciaDto;
  @IsOptional() @IsString() @MaxLength(250) observacionesAcceso?: string;
  @IsOptional() @ValidateNested() @Type(() => HuellaDto) huella?: HuellaDto;
}
