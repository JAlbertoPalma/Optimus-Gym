# OptimusGym

Sistema de gestión de gimnasio con acceso biométrico. Proyecto Integrador ITSON · RUP · Elaboración E1.

**Avance actual:** CU-02 Administrar Clientes completo en la API (alta, búsqueda, ficha, edición, enrolamiento/reenrolamiento de huella, baja lógica y reactivación) + migraciones 0001 y 0002 + interfaz web demo.

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
```

## Pruebas
Con la API encendida, en otra terminal. Las dos suites se pueden repetir sin reiniciar la base de datos.
```bash
npm run api:probar           # alta y búsqueda   → 14 correctas
npm run api:probar:gestion   # ficha, edición, huella, baja/reactivar → 26 correctas
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

## Estructura
```
apps/api/
  db/migraciones/0001_modelo_fase1.sql          modelo de datos Fase 1 (11 tablas)
  db/migraciones/0002_cu02_gestion_clientes.sql dirección y versionado de huellas (activa/inactiva)
  db/{migrar,semilla,reiniciar}.ts
  src/main.ts        arranque de la API y validación de la configuración
  src/clientes/      CU-02: controlador, servicio y DTOs (registrar y gestionar)
  src/comun/         errores, cifrado AES-256-GCM, sesión demo provisional
  src/huellas/       comparador SIMULADO (se cambiará por el SDK del lector)
  public/            interfaz web: index.html, app.js, estilos.css
  test/humo.ts           pruebas del alta y la búsqueda
  test/humo-gestion.ts   pruebas de la gestión del cliente
```

## Notas importantes
- Solo desarrollo: usuario `admin` / `admin123` y clave de cifrado de ejemplo. Nunca subir `.env` a Git.
- La sesión es provisional (actúa como `admin`) hasta implementar el login (CU-01).
- Las huellas son simuladas; no se guarda imagen, solo plantilla cifrada.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`).

## Siguiente
1. Login y roles (CU-01 / CU-08). 2. App de escritorio Electron + React. 3. Integrar SDK del lector. 4. Membresías y pagos (CU-03/04). 5. Migraciones Fase 2.
