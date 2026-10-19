# OptimusGym

Sistema de gestión de gimnasio con acceso biométrico. Proyecto Integrador ITSON · RUP · Elaboración E1.

**Avance actual:** CU-02 `registrarCliente` (API) + migración de la Fase 1 (11 tablas) + pantalla demo.

## Requisitos
- Git, Node.js LTS (20 o 22), PostgreSQL 14+ (y DBeaver para ver las tablas)
- VS Code con extensiones: ESLint, Prettier, PostgreSQL/SQLTools (opcional), REST Client (opcional)

## Primeros pasos
```bash
npm install                       # en la raíz del proyecto
cp apps/api/.env.example apps/api/.env     # Windows: copy apps\api\.env.example apps\api\.env
# edita apps/api/.env y pon TU contraseña de PostgreSQL en DATABASE_URL
createdb -U postgres optimusgym   # o créala desde DBeaver/pgAdmin con nombre: optimusgym
npm run db:reiniciar              # crea las 11 tablas + datos iniciales
npm run api:dev                   # API en http://localhost:3000
```
- Demo visual: abre http://localhost:3000
- Salud: http://localhost:3000/health
- Pruebas (con la API encendida, en otra terminal): `npm run api:probar` → deben salir 12 correctas.

## Estructura
```
apps/api/
  db/migraciones/0001_modelo_fase1.sql   modelo de datos Fase 1 (Fase 2 = migraciones siguientes)
  db/{migrar,semilla,reiniciar}.ts
  src/clientes/      CU-02: controlador, servicio (registrarCliente, buscar), DTO
  src/comun/         errores, cifrado AES-256-GCM, sesión demo provisional
  src/huellas/       comparador SIMULADO (se cambiará por el SDK del lector)
  public/index.html  pantalla demo
  test/humo.ts       12 pruebas de humo
```

## Notas importantes
- Solo desarrollo: usuario `admin` / `admin123` y clave de cifrado de ejemplo. Nunca subir `.env` a Git.
- La sesión es provisional (actúa como `admin`) hasta implementar el login (CU-01).
- Las huellas son simuladas; no se guarda imagen, solo plantilla cifrada.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`).

## Siguiente
1. Login y roles (CU-01 / CU-08). 2. Modificar, baja lógica y reenrolamiento (CU-02). 3. App de escritorio Electron + React. 4. Integrar SDK del lector. 5. Membresías y pagos (CU-03/04). 6. Migraciones Fase 2.
# Optimus-Gym
