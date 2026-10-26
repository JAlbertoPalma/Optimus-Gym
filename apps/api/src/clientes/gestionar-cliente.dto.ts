// DTOs de la GESTIÓN del cliente (CU-02, subflujos posteriores al alta):
//  - ActualizarClienteDto  → PATCH /clientes/:codigo   (SF-02 editar datos)
//  - DarDeBajaDto          → POST  /clientes/:codigo/baja (SF-04)
// El enrolamiento de huella (SF-03) reutiliza HuellaDto de registrar-cliente.dto.ts.
//
// Todos los campos de edición son OPCIONAL: en SF-02 solo se envían los que cambian.
// Las reglas de negocio (duplicados, sin cambios, obligatoriedad del motivo de acceso
// cuando no hay huella, etc.) se revisan en clientes.service.ts, no aquí.
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

// Igual que en registrar-cliente.dto.ts: "(644) 123-4567" → "6441234567".
const soloDigitos = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[\s().-]/g, '') : value);

// Contacto de emergencia para EDICIÓN: cada subcampo es opcional.
export class ContactoEmergenciaParcialDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) nombre?: string;
  @IsOptional() @Transform(soloDigitos)
  @Matches(/^\d{10}$/, { message: 'El teléfono debe tener 10 dígitos' }) telefono?: string;
  @IsOptional() @IsString() @MaxLength(40) parentesco?: string;
}

// SF-02: datos editables del cliente. Lo que no venga, no se toca.
export class ActualizarClienteDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) nombres?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) apellidoPaterno?: string;
  @IsOptional() @IsString() @MaxLength(60) apellidoMaterno?: string;
  @IsOptional() @IsDateString({}, { message: 'La fecha de nacimiento debe tener formato AAAA-MM-DD' }) fechaNacimiento?: string;
  @IsOptional() @IsIn(['F', 'M', 'O'], { message: 'El sexo debe ser F, M u O' }) sexo?: 'F' | 'M' | 'O';
  @IsOptional() @Transform(soloDigitos)
  @Matches(/^\d{10}$/, { message: 'El teléfono debe tener 10 dígitos' }) telefono?: string;
  @IsOptional() @IsEmail({}, { message: 'Correo con formato inválido' }) correo?: string;
  @IsOptional() @IsString() @MaxLength(250) direccion?: string;
  @IsOptional() @IsString() @MaxLength(250) observacionesAcceso?: string;
  @IsOptional() @ValidateNested() @Type(() => ContactoEmergenciaParcialDto) contactoEmergencia?: ContactoEmergenciaParcialDto;
}

// SF-04: dar de baja exige siempre un motivo.
// El @Transform quita los espacios ANTES de validar; sin él, un motivo de puros espacios
// pasaba @IsNotEmpty y la baja se guardaba con el motivo vacío.
export class DarDeBajaDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @IsNotEmpty({ message: 'El motivo de baja es obligatorio' }) @MaxLength(250) motivo: string;
}
