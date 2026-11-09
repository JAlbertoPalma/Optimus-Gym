// SEMILLA: `npm run db:semilla`. Inserta los datos mínimos para que el sistema funcione:
// roles, tipos de membresía y el empleado "admin" (que usa comun/sesion-demo.service.ts).
// Se puede ejecutar varias veces sin duplicar nada gracias a ON CONFLICT DO NOTHING
// y a la revisión de si "admin" ya existe.
import { hash } from '@node-rs/argon2';
import { nuevoCliente } from './conexion';

export async function sembrar(): Promise<void> {
  const db = nuevoCliente();
  await db.connect();
  try {
    await db.query('BEGIN');
    // Roles del sistema: [nombre, descripción]
    for (const [n, d] of [
      ['Administrador', 'Acceso total al sistema'],
      ['Recepcionista', 'Altas de clientes, enrolamiento biométrico y cobros'],
      ['Entrenador', 'Consulta de clases y asistencia'],
    ]) await db.query('INSERT INTO rol (nombre, descripcion) VALUES ($1,$2) ON CONFLICT (nombre) DO NOTHING', [n, d]);

    // Tipos de membresía: [nombre, duración en días, precio, descripción del acceso, días del mes en que se vende (null = todos)]
    // Los precios solo se fijan al crear el plan; si ya existe, NO se tocan (los cambia el administrador
    // o una migración, como la 0005).
    for (const [n, dias, precio, detalles, diasDisponibles] of [
      ['Visita', 1, 50, 'Acceso por un día al área de pesas y cardio', null],
      ['Semanal', 7, 200, 'Acceso ilimitado al gimnasio durante 7 días', null],
      ['Mensual', 30, 600, 'Acceso ilimitado al gimnasio durante 30 días', null],
      ['Estudiante', 30, 550, 'Acceso ilimitado durante 30 días. Presentar credencial escolar vigente', null],
      ['Precio especial', 30, 550, 'Acceso ilimitado durante 30 días. Solo se vende el día 1 y el 15 de cada mes', [1, 15]],
      ['Trimestral', 90, 1500, 'Acceso ilimitado al gimnasio durante 90 días', null],
      ['Anual', 365, 5200, 'Acceso ilimitado al gimnasio durante 365 días', null],
    ]) {
      await db.query(
        'INSERT INTO tipo_membresia (nombre, duracion_dias, precio, detalles, dias_disponibles) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (nombre) DO NOTHING',
        [n, dias, precio, detalles, diasDisponibles]);
      await db.query('UPDATE tipo_membresia SET detalles = $2 WHERE nombre = $1 AND detalles IS NULL', [n, detalles]);
    }

    // Empleado administrador: primero su registro en persona, luego en empleado y su rol
    const ya = await db.query("SELECT 1 FROM empleado WHERE nombre_usuario = 'admin'");
    if (ya.rowCount === 0) {
      const p = await db.query(
        `INSERT INTO persona (nombres, apellido_paterno, fecha_nacimiento, sexo, telefono, correo)
         VALUES ('Administrador','Sistema','1990-01-01','O','0000000000','admin@optimusgym.local') RETURNING id_persona`);
      const id = p.rows[0].id_persona;
      // SOLO DESARROLLO: contraseña inicial admin123 (cambiar en CU-01).
      // Se guarda el hash Argon2, nunca la contraseña en texto plano.
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

// Solo se ejecuta si este archivo se corre directamente (no cuando lo importa reiniciar.ts)
if (require.main === module) sembrar().catch((e) => { console.error(e.message); process.exit(1); });
