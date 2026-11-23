# Bitácora de cambios aprobados · OptimusGym

Registro de las solicitudes de cambio aprobadas en la fase de Elaboración. Cada entrada indica el motivo y el artefacto relacionado (migración o archivo).

| ID | Cambio | Motivo | Migración o archivo relacionado |
|---|---|---|---|
| **CC-01** | MER con **Persona**, **Cliente** y **Empleado** | Una misma persona puede ser cliente y empleado. Los datos generales (nombre, teléfono, correo) se guardan una sola vez y no se duplican. | `apps/api/db/migraciones/0001_modelo_fase1.sql` |
| **CC-02** | Stack **NestJS + PostgreSQL + Electron + React**; interfaz web provisional mientras tanto | Un solo lenguaje (TypeScript) en la API y en el escritorio, y una base relacional con transacciones. La interfaz web permite validar los CU antes de tener Electron. | `apps/api/` (NestJS), `apps/api/public/` (interfaz provisional) |
| **CC-03** | **CU-04** adelantado a E1 | La venta de membresía es el flujo central del negocio y del que depende el acceso, así que conviene validar su arquitectura en Elaboración. | `apps/api/src/ventas/`, `apps/api/db/migraciones/0003_cu04_venta_membresia.sql` |
| **CC-04** | Promociones eliminadas; **CU-07 retirado** | El gimnasio no maneja promociones por ahora; mantenerlas complicaba el cálculo del total sin aportar valor. | `apps/api/db/migraciones/0004_cu04_sin_promociones.sql` |
| **CC-05** | Reglas de venta vigentes: la nueva membresía reemplaza a la anterior, inicio siempre hoy, regla de 7 días y `PLAN_VENCE_ANTES`, planes por día del mes, nuevos precios y pago sin referencia | Alinear el sistema con la operación real de recepción (O-01, O-02). | `apps/api/db/migraciones/0005_cu04_planes_y_pagos.sql`, `apps/api/src/ventas/calculos-venta.ts`, `apps/api/db/semilla.ts` |
| **CC-06** | Integración del **lector de huellas real** pasa a C1 | En E1 se validó el flujo con un comparador simulado; el SDK del lector se integra en Construcción. | `apps/api/src/huellas/comparador-huellas.service.ts` |
| **CC-07** | **CU-05** pasa a la Fase 2 | Repriorización del alcance para cumplir la Fase 1. | — (sin artefacto en E1) |
