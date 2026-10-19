import { hash } from '@node-rs/argon2';
import { nuevoCliente } from './conexion';

export async function sembrar(): Promise<void> {
  const db = nuevoCliente();
  await db.connect();
  try {
    await db.query('BEGIN');
    for (const [n, d] of [
      ['Administrador', 'Acceso total al sistema'],
      ['Recepcionista', 'Altas de clientes, enrolamiento biométrico y cobros'],
      ['Entrenador', 'Consulta de clases y asistencia'],
    ]) await db.query('INSERT INTO rol (nombre, descripcion) VALUES ($1,$2) ON CONFLICT (nombre) DO NOTHING', [n, d]);

    for (const [n, dias, precio] of [['Visita', 1, 50], ['Mensual', 30, 450], ['Anual', 365, 4500]])
      await db.query('INSERT INTO tipo_membresia (nombre, duracion_dias, precio) VALUES ($1,$2,$3) ON CONFLICT (nombre) DO NOTHING', [n, dias, precio]);

    const ya = await db.query("SELECT 1 FROM empleado WHERE nombre_usuario = 'admin'");
    if (ya.rowCount === 0) {
      const p = await db.query(
        `INSERT INTO persona (nombres, apellido_paterno, fecha_nacimiento, sexo, telefono, correo)
         VALUES ('Administrador','Sistema','1990-01-01','O','0000000000','admin@optimusgym.local') RETURNING id_persona`);
      const id = p.rows[0].id_persona;
      // SOLO DESARROLLO: contraseña inicial admin123 (cambiar en CU-01).
      await db.query("INSERT INTO empleado (id_persona, nombre_usuario, contrasena_hash) VALUES ($1,'admin',$2)", [id, await hash('admin123')]);
      await db.query("INSERT INTO empleado_rol SELECT $1, id_rol FROM rol WHERE nombre='Administrador'", [id]);
    }
    await db.query('COMMIT');
    console.log('Semilla aplicada (roles, tipos de membresía, usuario admin).');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    await db.end();
  }
}

if (require.main === module) sembrar().catch((e) => { console.error(e.message); process.exit(1); });
