// SEMILLA: `npm run db:semilla`. Inserta los datos mínimos para que el sistema funcione:
// roles, tipos de membresía, promociones (CU-04) y el empleado "admin" (que usa comun/sesion-demo.service.ts).
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

    // Tipos de membresía: [nombre, duración en días, precio, descripción del acceso]
    // Los precios solo se fijan al crear el plan; si ya existe, NO se tocan (los cambia el administrador).
    for (const [n, dias, precio, detalles] of [
      ['Visita', 1, 50, 'Acceso por un día al área de pesas y cardio'],
      ['Mensual', 30, 450, 'Acceso ilimitado al gimnasio durante 30 días'],
      ['Trimestral', 90, 1500, 'Acceso ilimitado al gimnasio durante 90 días'],
      ['Anual', 365, 4500, 'Acceso ilimitado al gimnasio durante 365 días'],
    ]) {
      await db.query('INSERT INTO tipo_membresia (nombre, duracion_dias, precio, detalles) VALUES ($1,$2,$3,$4) ON CONFLICT (nombre) DO NOTHING', [n, dias, precio, detalles]);
      await db.query('UPDATE tipo_membresia SET detalles = $2 WHERE nombre = $1 AND detalles IS NULL', [n, detalles]);
    }

    // CU-04 promociones de ejemplo: [nombre, descripción, tipo, valor, requisito, requiere verificación, edad mínima]
    // Todas aplican solo al plan Mensual. "Regreso a clases" solo vale del 1 de agosto al 30 de septiembre del año en curso.
    for (const [n, desc, tipo, valor, requisito, verificar, edad] of [
      ['Estudiante', 'Descuento de $50 en mensualidad', 'MONTO', 50, 'Identificación escolar vigente', true, null],
      ['Adulto mayor', 'Descuento de $50 en mensualidad', 'MONTO', 50, 'Identificación oficial que acredite 60 años o más', true, 60],
      ['Regreso a clases', 'Descuento del 10% en mensualidad', 'PORCENTAJE', 10, null, false, null],
    ]) {
      await db.query(
        `INSERT INTO promocion (nombre, descripcion, tipo_descuento, valor, requisito, requiere_verificacion, edad_minima)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (nombre) DO NOTHING`, [n, desc, tipo, valor, requisito, verificar, edad]);
      await db.query(
        `INSERT INTO promocion_tipo_membresia (id_promocion, id_tipo)
         SELECT p.id_promocion, t.id_tipo FROM promocion p, tipo_membresia t
          WHERE p.nombre = $1 AND t.nombre = 'Mensual' ON CONFLICT DO NOTHING`, [n]);
    }
    await db.query(
      `UPDATE promocion SET fecha_inicio = make_date(extract(year FROM current_date)::int, 8, 1),
                            fecha_fin    = make_date(extract(year FROM current_date)::int, 9, 30)
        WHERE nombre = 'Regreso a clases' AND fecha_inicio IS NULL`);

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
    console.log('Semilla aplicada (roles, tipos de membresía, promociones, usuario admin).');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    await db.end();
  }
}

// Solo se ejecuta si este archivo se corre directamente (no cuando lo importa reiniciar.ts)
if (require.main === module) sembrar().catch((e) => { console.error(e.message); process.exit(1); });
