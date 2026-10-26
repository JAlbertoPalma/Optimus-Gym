// REINICIAR: `npm run db:reiniciar`. ¡BORRA TODOS LOS DATOS!
// Elimina todas las tablas, las vuelve a crear (migrar.ts) y carga los datos iniciales (semilla.ts).
// Útil en desarrollo para empezar con una base de datos limpia.
import { nuevoCliente } from './conexion';
import { migrar } from './migrar';
import { sembrar } from './semilla';

(async () => {
  const db = nuevoCliente();
  await db.connect();
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.end();
  await migrar();
  await sembrar();
})().catch((e) => { console.error(e.message); process.exit(1); });
