-- OptimusGym · Migración 0002 · CU-02 Administrar Clientes (gestión) · PostgreSQL 14+
-- Agrega: dirección en persona, y versionado de huellas (plantillas activas/inactivas)
-- para poder reenrolar un dedo sin borrar el historial de la plantilla anterior.

-- Dato de contacto adicional (editable en SF-02).
ALTER TABLE persona ADD COLUMN direccion VARCHAR(250);

-- Marca si la plantilla es la vigente del dedo. Al reenrolar (SF-03) la anterior
-- pasa a activa = false y se inserta una nueva activa; nunca se borra la fila.
ALTER TABLE plantilla_biometrica ADD COLUMN activa BOOLEAN NOT NULL DEFAULT TRUE;

-- La restricción UNIQUE (id_persona, dedo) del 0001 impediría guardar el historial
-- (una fila vieja inactiva + la nueva activa del mismo dedo). Se reemplaza por un
-- índice único PARCIAL: a lo sumo UNA plantilla activa por (persona, dedo).
ALTER TABLE plantilla_biometrica DROP CONSTRAINT IF EXISTS plantilla_biometrica_id_persona_dedo_key;
CREATE UNIQUE INDEX ux_plantilla_activa ON plantilla_biometrica (id_persona, dedo) WHERE activa;
