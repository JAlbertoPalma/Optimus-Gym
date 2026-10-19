import 'dotenv/config';
import { Client } from 'pg';

export function nuevoCliente(): Client {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en apps/api/.env');
  return new Client({ connectionString: process.env.DATABASE_URL });
}
