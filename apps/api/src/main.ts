// =============================================================================
// PUNTO DE ENTRADA DEL SERVIDOR
// Es el primer archivo que se ejecuta con `npm run api:dev`.
// Crea la aplicación NestJS, la configura y la pone a escuchar en un puerto.
//
// Recorrido de una petición (ejemplo: registrar un cliente):
//   1. public/index.html             → el navegador hace fetch POST /api/v1/clientes
//   2. main.ts (ValidationPipe)      → valida el JSON con clientes/registrar-cliente.dto.ts
//   3. clientes/clientes.controller  → recibe la petición y llama al servicio
//   4. clientes/clientes.service     → aplica las reglas de negocio y guarda en PostgreSQL
//   5. La respuesta JSON regresa a index.html, que la muestra en pantalla
//   Si algo falla en cualquier paso, comun/errores.ts (FiltroErrores) arma la respuesta de error.
// =============================================================================
import 'dotenv/config'; // carga las variables de apps/api/.env dentro de process.env
import 'reflect-metadata'; // necesario para que funcionen los decoradores (@Module, @Get, @IsString…)
import { ValidationError, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { ErrorNegocio, FiltroErrores } from './comun/errores';
import { CALIDAD_MINIMA, UMBRAL_DUPLICADO } from './huellas/comparador-huellas.service';

// Revisa el .env al arrancar. Es mejor que la API no inicie y diga qué falta,
// a que arranque y falle a media operación (por ejemplo, al cifrar la primera huella).
function validarConfiguracion() {
  const errores: string[] = [];
  if (!process.env.DATABASE_URL) errores.push('Falta DATABASE_URL');
  if (!/^[0-9a-fA-F]{64}$/.test(process.env.CLAVE_CIFRADO ?? '')) errores.push('CLAVE_CIFRADO debe tener 64 caracteres hexadecimales');
  // La tabla plantilla_biometrica tiene CHECK (calidad BETWEEN 70 AND 100): un mínimo menor a 70
  // dejaría pasar huellas que la base de datos después rechaza con un error 500.
  const calidad = CALIDAD_MINIMA();
  if (!Number.isInteger(calidad) || calidad < 70 || calidad > 100) errores.push('CALIDAD_MINIMA debe ser un entero entre 70 y 100');
  const umbral = UMBRAL_DUPLICADO();
  if (!(umbral > 0 && umbral <= 100)) errores.push('UMBRAL_DUPLICADO debe ser un número mayor a 0 y hasta 100');
  if (errores.length) {
    console.error('Configuración inválida en apps/api/.env:\n  - ' + errores.join('\n  - '));
    process.exit(1);
  }
}

// Los errores de validación vienen anidados (ej. contactoEmergencia → telefono).
// Esta función los convierte en un objeto plano:
//   { "contactoEmergencia.telefono": "El teléfono debe tener 10 dígitos" }
// Ese objeto llega a index.html como "campos" y se muestra entre paréntesis.
function aplanar(errs: ValidationError[], prefijo = '', out: Record<string, string> = {}) {
  for (const e of errs) {
    const campo = prefijo + e.property;
    if (e.constraints) out[campo] = Object.values(e.constraints)[0]; // solo el primer mensaje de cada campo
    if (e.children?.length) aplanar(e.children, campo + '.', out); // se llama a sí misma para objetos internos
  }
  return out;
}

async function bootstrap() {
  validarConfiguracion();

  // Crea la app a partir del módulo raíz (app.module.ts), que carga los demás módulos
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Sirve los archivos de la carpeta /public: por eso http://localhost:3000 abre index.html
  app.useStaticAssets(join(__dirname, '..', 'public'));

  // Todas las rutas quedan bajo /api/v1 (ej. /api/v1/clientes), excepto /health
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  // Permite que páginas de otros orígenes (ej. la futura app Electron) llamen a la API
  app.enableCors();

  // Cualquier error lanzado en la app pasa por FiltroErrores (comun/errores.ts)
  app.useGlobalFilters(new FiltroErrores());

  // Valida automáticamente el cuerpo de cada petición contra su DTO:
  //  - whitelist: descarta los campos que no estén declarados en el DTO
  //  - transform: convierte el JSON en una instancia del DTO (y aplica los @Transform)
  //  - exceptionFactory: si hay datos inválidos, lanza nuestro ErrorNegocio con estado 422
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, transform: true,
    exceptionFactory: (errs) => new ErrorNegocio('DATOS_INVALIDOS', 'Hay datos inválidos', 422, aplanar(errs)),
  }));

  const puerto = Number(process.env.PORT ?? 3000);
  await app.listen(puerto);
  console.log(`API OptimusGym en http://localhost:${puerto}  (demo web en /, salud: /health)`);
}
bootstrap();
