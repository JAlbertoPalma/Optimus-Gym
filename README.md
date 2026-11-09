# OptimusGym

Sistema de gestión de gimnasio con acceso biométrico. Proyecto Integrador ITSON · RUP · Elaboración E1.

**Avance actual:** CU-02 Administrar Clientes completo en la API (alta, búsqueda, ficha, edición, enrolamiento/reenrolamiento de huella, baja lógica y reactivación) + CU-04 Registrar venta de membresía (planes, cobro, vigencia y recibo) + migraciones 0001 a 0005 + interfaz web demo.

## Requisitos
- Git, Node.js LTS (20 o 22), PostgreSQL 14+ (y DBeaver para ver las tablas)
- VS Code con extensiones: ESLint, Prettier, PostgreSQL/SQLTools (opcional), REST Client (opcional)

## Primeros pasos
```bash
npm install                       # en la raíz del proyecto
cp apps/api/.env.example apps/api/.env     # Windows: copy apps\api\.env.example apps\api\.env
# edita apps/api/.env y pon TU contraseña de PostgreSQL en DATABASE_URL
createdb -U postgres optimusgym   # o créala desde DBeaver/pgAdmin con nombre: optimusgym
npm run db:reiniciar              # crea las tablas + datos iniciales (BORRA lo que hubiera)
npm run api:dev                   # API en http://localhost:3000
```
- Interfaz web: abre http://localhost:3000
- Salud: http://localhost:3000/health
- Si la API no arranca y dice "Configuración inválida", revisa los valores de `apps/api/.env`.

### Después de hacer `git pull`
```bash
npm install          # por si cambiaron dependencias
npm run db:migrar    # aplica solo las migraciones nuevas, sin borrar datos
npm run db:semilla   # agrega datos iniciales nuevos (ej. planes Semanal, Estudiante y Precio especial); no duplica ni cambia precios
```

## Pruebas
Con la API encendida, en otra terminal. Las dos suites se pueden repetir sin reiniciar la base de datos.
```bash
npm run api:probar           # alta y búsqueda   → 14 correctas
npm run api:probar:gestion   # ficha, edición, huella, baja/reactivar → 26 correctas
npm run api:probar:venta     # CU-04 venta, pagos, duplicados, reemplazo de membresía
npm run api:probar:calculos  # CU-04 cálculos (no requiere la API encendida) → 29 correctas
```

## API (prefijo `/api/v1`)
| Método | Ruta | Qué hace | CU-02 |
|---|---|---|---|
| POST | `/clientes` | Registrar cliente | FB-01 |
| GET | `/clientes?q=&estatus=` | Buscar / listar | SF-01 |
| GET | `/clientes/:codigo` | Ficha del cliente | — |
| PATCH | `/clientes/:codigo` | Editar datos (solo lo enviado) | SF-02 |
| POST | `/clientes/:codigo/huella` | Enrolar / reenrolar huella | SF-03, FA-04 |
| POST | `/clientes/:codigo/baja` | Baja lógica (motivo obligatorio) | SF-04 |
| POST | `/clientes/:codigo/reactivar` | Reactivar | SF-04 |

| Método | Ruta | Qué hace | CU-04 |
|---|---|---|---|
| GET | `/ventas/catalogo` | Planes activos y métodos de pago | — |
| GET | `/ventas/clientes/:codigo` | Cliente, membresía vigente y estado de acceso | — |
| POST | `/ventas/cotizar` | Calcula precio, total y vigencia (no guarda) | — |
| POST | `/ventas` | Registra la venta (idempotente por `claveIdempotencia`) | FB |
| GET | `/ventas/:folio` | Recibo de una venta (reimpresión) | — |

Interfaz de venta: http://localhost:3000/venta.html (o `venta.html?cliente=OG-00001`).

### Reglas del CU-04
- **Precios** se leen de `tipo_membresia`; el servidor recalcula el total (el navegador no envía importes a cobrar).
- **Planes por día del mes:** `tipo_membresia.dias_disponibles` (ej. Precio especial solo el 1 y el 15); fuera de esos días no aparece en el catálogo ni se puede cobrar.
- **Tarjeta y transferencia** se cobran fuera del sistema; solo se registra el método de pago (sin referencia).
- **Sin promociones por ahora** (la migración 0004 elimina las tablas de promociones).
- **Vigencia ("la nueva reemplaza a la anterior"):** los días NO se apilan. La membresía nueva siempre inicia hoy y la anterior deja de contar (queda en el historial). La membresía actual es la última vendida. Fin = inicio + duración − 1.
- **Reemplazo de una membresía vigente:** solo si le faltan **menos de 7 días** para vencer (si no → `MEMBRESIA_VIGENTE`) y si el plan nuevo vence **después** que ella (el mismo día o antes → `PLAN_VENCE_ANTES`). Cuando se permite, se advierte que se sobrescribirá su fecha de vencimiento.
- **Transaccional y sin duplicados:** membresía + pago + bitácora en una transacción; candado por cliente y `clave_idempotencia` única.
- **Acceso:** se deriva de las membresías pagadas vigentes. El torniquete aún no está integrado.
- **Permisos:** solo empleados activos con rol Administrador o Recepcionista.

## Estructura
```
apps/api/
  db/migraciones/0001_modelo_fase1.sql          modelo de datos Fase 1 (11 tablas)
  db/migraciones/0002_cu02_gestion_clientes.sql dirección y versionado de huellas (activa/inactiva)
  db/migraciones/0003_cu04_venta_membresia.sql  datos del cobro y folio de venta
  db/migraciones/0004_cu04_sin_promociones.sql  elimina las promociones
  db/migraciones/0005_cu04_planes_y_pagos.sql   planes por día del mes, nuevos precios, quita la referencia de pago
  db/{migrar,semilla,reiniciar}.ts
  src/main.ts        arranque de la API y validación de la configuración
  src/clientes/      CU-02: controlador, servicio y DTOs (registrar y gestionar)
  src/ventas/        CU-04: controlador, servicio, DTOs y cálculos puros (calculos-venta.ts)
  src/comun/         errores, cifrado AES-256-GCM, sesión demo provisional (con exigirRol)
  src/huellas/       comparador SIMULADO (se cambiará por el SDK del lector)
  public/            interfaz web: index.html, app.js, estilos.css · venta.html, venta.js, venta.css (CU-04)
  test/humo.ts           pruebas del alta y la búsqueda
  test/humo-gestion.ts   pruebas de la gestión del cliente
  test/humo-venta.ts     pruebas de la venta de membresía (CU-04)
  test/calculos-venta.ts pruebas unitarias de los cálculos del CU-04
```

## Notas importantes
- Solo desarrollo: usuario `admin` / `admin123` y clave de cifrado de ejemplo. Nunca subir `.env` a Git.
- La sesión es provisional (actúa como `admin`) hasta implementar el login (CU-01).
- Las huellas son simuladas; no se guarda imagen, solo plantilla cifrada.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`).

## Siguiente
1. Login y roles (CU-01 / CU-08). 2. App de escritorio Electron + React. 3. Integrar SDK del lector. 4. Membresías y pagos (CU-03/04). 5. Migraciones Fase 2.
