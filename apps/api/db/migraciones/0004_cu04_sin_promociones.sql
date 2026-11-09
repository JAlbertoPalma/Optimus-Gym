-- OptimusGym · Migración 0004 · CU-04 sin promociones · PostgreSQL 14+
-- Por ahora el sistema NO maneja promociones: se eliminan el catálogo de promociones (0003)
-- y las columnas de pago que guardaban la promoción aplicada.
-- pago.descuento se conserva (siempre 0) porque ck_pago_total la usa: monto = precio_original - descuento.
-- Nota: la vigencia ya no se apila (la nueva membresía reemplaza a la anterior); eso es lógica del
-- servicio y no requiere cambios de tablas: membresia_contratada sigue guardando todo el historial.

ALTER TABLE pago
  DROP COLUMN id_promocion,
  DROP COLUMN descripcion_descuento,
  DROP COLUMN verificacion_requisito;

DROP TABLE promocion_tipo_membresia;
DROP TABLE promocion;
