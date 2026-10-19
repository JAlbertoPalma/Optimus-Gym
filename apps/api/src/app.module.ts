import 'dotenv/config';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientesModule } from './clientes/clientes.module';
import { SaludController } from './salud/salud.controller';

@Module({
  imports: [
    TypeOrmModule.forRoot({ type: 'postgres', url: process.env.DATABASE_URL, synchronize: false, autoLoadEntities: true }),
    ClientesModule,
  ],
  controllers: [SaludController],
})
export class AppModule {}
