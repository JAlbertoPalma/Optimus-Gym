-- OptimusGym · Migración 0003 · CU-04 Registrar venta de membresía · PostgreSQL 14+
-- Agrega: catálogo de promociones (configurable en BD) y los datos del cobro que hacen
-- falta en "pago" para auditar cómo se calculó cada venta y evitar ventas duplicadas.
-- La venta = membresia_contratada (vigencia) + pago (cobro). Ambas filas se insertan
-- en una sola transacción y nunca se sobrescriben: así se conserva el historial.

-- Folio visible del recibo: V-000001, V-000002… (mismo patrón que persona.codigo)
CREATE SEQUENCE seq_folio_venta START 1;
ALTER TABLE pago ALTER COLUMN folio_recibo SET DEFAULT ('V-' || lpad(nextval('seq_folio_venta')::text, 6, '0'));

-- Promociones. Un descuento es un MONTO fijo ($) o un PORCENTAJE sobre el precio del plan.
--  - fecha_inicio / fecha_fin: periodo promocional (NULL = sin límite por ese lado)
--  - requisito: documento que recepción debe revisar (credencial escolar, INE…)
--  - requiere_verificacion: si es true, la venta exige registrar qué se verificó
--  - edad_minima: si existe, se valida contra la fecha de nacimiento del cliente
CREATE TABLE promocion (
  id_promocion          SERIAL PRIMARY KEY,
  nombre                VARCHAR(60) NOT NULL UNIQUE,
  descripcion           VARCHAR(250),
  tipo_descuento        VARCHAR(10) NOT NULL CHECK (tipo_descuento IN ('MONTO','PORCENTAJE')),
  valor                 NUMERIC(10,2) NOT NULL CHECK (valor > 0),
  fecha_inicio          DATE,
  fecha_fin             DATE,
  requisito             VARCHAR(250),
  requiere_verificacion BOOLEAN NOT NULL DEFAULT FALSE,
  edad_minima           SMALLINT CHECK (edad_minima BETWEEN 1 AND 120),
  activa                BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (tipo_descuento <> 'PORCENTAJE' OR valor <= 100),
  CHECK (fecha_inicio IS NULL OR fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
);

-- A qué planes aplica cada promoción. Sin fila aquí, la promoción no aplica a ese plan.
CREATE TABLE promocion_tipo_membresia (
  id_promocion INT NOT NULL REFERENCES promocion (id_promocion),
  id_tipo      INT NOT NULL REFERENCES tipo_membresia (id_tipo),
  PRIMARY KEY (id_promocion, id_tipo)
);

-- Datos del cobro. Son NULL solo en pagos anteriores a esta migración.
--  - plan_nombre / plan_duracion_dias / precio_original: copia de cómo estaba el plan al
--    vender; si después cambia su precio o nombre, el recibo histórico no se altera.
--  - descripcion_descuento: copia del nombre/regla de la promoción aplicada.
--  - clave_idempotencia: la genera el navegador por operación; UNIQUE impide que un doble
--    clic o un reintento registre la misma venta dos veces.
ALTER TABLE pago
  ADD COLUMN plan_nombre            VARCHAR(60),
  ADD COLUMN plan_duracion_dias     INT CHECK (plan_duracion_dias > 0),
  ADD COLUMN precio_original        NUMERIC(10,2) CHECK (precio_original >= 0),
  ADD COLUMN id_promocion           INT REFERENCES promocion (id_promocion),
  ADD COLUMN descripcion_descuento  VARCHAR(120),
  ADD COLUMN verificacion_requisito VARCHAR(250),
  ADD COLUMN importe_recibido       NUMERIC(10,2),
  ADD COLUMN cambio                 NUMERIC(10,2) CHECK (cambio >= 0),
  ADD COLUMN referencia_pago        VARCHAR(60),
  ADD COLUMN clave_idempotencia     UUID UNIQUE,
  -- El total debe cuadrar con precio − descuento, y el efectivo recibido debe cubrirlo
  ADD CONSTRAINT ck_pago_total CHECK (precio_original IS NULL OR monto = precio_original - descuento),
  ADD CONSTRAINT ck_pago_recibido CHECK (importe_recibido IS NULL OR importe_recibido >= monto);

CREATE INDEX ix_pago_fecha ON pago (fecha_hora);
