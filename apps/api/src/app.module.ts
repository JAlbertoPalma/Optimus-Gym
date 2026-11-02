// MÓDULO RAÍZ: lo carga main.ts.
// En NestJS un "módulo" agrupa controladores y servicios relacionados.
// Aquí se configura la conexión a la base de datos y se registran los módulos de cada funcionalidad.
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientesModule } from './clientes/clientes.module';
import { SaludController } from './salud/salud.controller';
import { VentasModule } from './ventas/ventas.module';

@Module({
  imports: [
    // Conexión a PostgreSQL con DATABASE_URL del .env.
    // synchronize: false → TypeORM NO modifica las tablas; se crean con las migraciones (db/migraciones).
    // autoLoadEntities: carga las entidades de los módulos (por ahora se usa SQL directo, sin entidades).
    // Esta conexión crea el objeto DataSource que reciben los servicios para hacer consultas.
    TypeOrmModule.forRoot({ type: 'postgres', url: process.env.DATABASE_URL, synchronize: false, autoLoadEntities: true }),
    // CU-02 Administrar Clientes → ver clientes/clientes.module.ts
    ClientesModule,
    // CU-04 Registrar venta de membresía → ver ventas/ventas.module.ts
    VentasModule,
  ],
  // GET /health: sirve para comprobar que la API y la base de datos funcionan
  controllers: [SaludController],
})
export class AppModule {}
