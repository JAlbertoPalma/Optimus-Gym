import 'dotenv/config';
import 'reflect-metadata';
import { ValidationError, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { ErrorNegocio, FiltroErrores } from './comun/errores';

function aplanar(errs: ValidationError[], prefijo = '', out: Record<string, string> = {}) {
  for (const e of errs) {
    const campo = prefijo + e.property;
    if (e.constraints) out[campo] = Object.values(e.constraints)[0];
    if (e.children?.length) aplanar(e.children, campo + '.', out);
  }
  return out;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.enableCors();
  app.useGlobalFilters(new FiltroErrores());
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, transform: true,
    exceptionFactory: (errs) => new ErrorNegocio('DATOS_INVALIDOS', 'Hay datos inválidos', 422, aplanar(errs)),
  }));
  const puerto = Number(process.env.PORT ?? 3000);
  await app.listen(puerto);
  console.log(`API OptimusGym en http://localhost:${puerto}  (demo web en /, salud: /health)`);
}
bootstrap();
