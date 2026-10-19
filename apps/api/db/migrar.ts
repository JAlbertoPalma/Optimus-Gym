import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { nuevoCliente } from './conexion';

export async function migrar(): Promise<void> {
  const db = nuevoCliente();
  await db.connect();
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS _migraciones (
      nombre VARCHAR(120) PRIMARY KEY, aplicada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const hechas = new Set((await db.query('SELECT nombre FROM _migraciones')).rows.map((r) => r.nombre));
    const dir = join(__dirname, 'migraciones');
    const archivos = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of archivos) {
      if (hechas.has(f)) { console.log(`= ${f} (ya aplicada)`); continue; }
      await db.query('BEGIN');
      try {
        await db.query(readFileSync(join(dir, f), 'utf8'));
        await db.query('INSERT INTO _migraciones (nombre) VALUES ($1)', [f]);
        await db.query('COMMIT');
        console.log(`+ ${f} aplicada`);
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await db.end();
  }
}

if (require.main === module) migrar().catch((e) => { console.error(e.message); process.exit(1); });
