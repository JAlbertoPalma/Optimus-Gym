-- OptimusGym · Migración 0005 · CU-04 ajustes de planes y pagos · PostgreSQL 14+
-- 1. Tarjeta y transferencia ya no guardan referencia (no. de autorización / clave de rastreo).
-- 2. Planes que solo se venden ciertos días del mes (ej. "Precio especial" el 1 y el 15).
-- 3. Nuevos precios de los planes existentes.
-- Los planes nuevos (Precio especial, Estudiante) los agrega db/semilla.ts.

ALTER TABLE pago DROP COLUMN referencia_pago;

-- Días del mes (1-31) en que se puede vender el plan. NULL = todos los días.
ALTER TABLE tipo_membresia
  ADD COLUMN dias_disponibles SMALLINT[]
  CHECK (dias_disponibles IS NULL OR (cardinality(dias_disponibles) > 0 AND 1 <= ALL (dias_disponibles) AND 31 >= ALL (dias_disponibles)));

-- Ajuste de precios. Solo afecta ventas futuras: cada pago guarda una copia del precio con el que se vendió.
UPDATE tipo_membresia SET precio = 600  WHERE nombre = 'Mensual';
UPDATE tipo_membresia SET precio = 1500 WHERE nombre = 'Trimestral';
UPDATE tipo_membresia SET precio = 5200 WHERE nombre = 'Anual';
