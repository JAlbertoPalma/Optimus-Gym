// Conexión a PostgreSQL para los scripts de la carpeta db/ (migrar, semilla, reiniciar).
// Estos scripts se ejecutan por separado de la API (con `npm run db:...`), por eso no usan
// la conexión de NestJS (app.module.ts) sino el cliente "pg" directamente.
import 'dotenv/config';
import { Client } from 'pg';

export function nuevoCliente(): Client {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en apps/api/.env');
  return new Client({ connectionString: process.env.DATABASE_URL });
}
