import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested, IsDateString } from 'class-validator';

export class ContactoEmergenciaDto {
  @IsString() @IsNotEmpty() @MaxLength(120) nombre: string;
  @Matches(/^\d{10}$/, { message: 'El teléfono debe tener 10 dígitos' }) telefono: string;
  @IsOptional() @IsString() @MaxLength(40) parentesco?: string;
}

export class HuellaDto {
  @IsInt() @Min(1) @Max(10) dedo: number;
  /** Plantilla (minucias) en base64. Nunca la imagen de la huella. */
  @IsString() @IsNotEmpty() plantillaBase64: string;
  @IsInt() @Min(0) @Max(100) calidad: number;
}

export class RegistrarClienteDto {
  @IsString() @IsNotEmpty() @MaxLength(80) nombres: string;
  @IsString() @IsNotEmpty() @MaxLength(60) apellidoPaterno: string;
  @IsOptional() @IsString() @MaxLength(60) apellidoMaterno?: string;
  @IsDateString({}, { message: 'La fecha de nacimiento debe tener formato AAAA-MM-DD' }) fechaNacimiento: string;
  @IsIn(['F', 'M', 'O'], { message: 'El sexo debe ser F, M u O' }) sexo: 'F' | 'M' | 'O';
  @Matches(/^\d{10}$/, { message: 'El teléfono debe tener 10 dígitos' }) telefono: string;
  @IsEmail({}, { message: 'Correo con formato inválido' }) correo: string;
  @ValidateNested() @Type(() => ContactoEmergenciaDto) contactoEmergencia: ContactoEmergenciaDto;
  @IsOptional() @IsString() @MaxLength(250) observacionesAcceso?: string;
  @IsOptional() @ValidateNested() @Type(() => HuellaDto) huella?: HuellaDto;
}
