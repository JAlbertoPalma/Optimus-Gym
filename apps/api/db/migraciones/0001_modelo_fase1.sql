-- OptimusGym · Migración 0001 · Modelo de datos Fase 1 (11 tablas) · PostgreSQL 14+
CREATE SEQUENCE seq_codigo_persona START 1;

CREATE TABLE rol (
  id_rol      SERIAL PRIMARY KEY,
  nombre      VARCHAR(40) NOT NULL UNIQUE,
  descripcion VARCHAR(200)
);

CREATE TABLE persona (
  id_persona       SERIAL PRIMARY KEY,
  codigo           VARCHAR(12) NOT NULL UNIQUE
                   DEFAULT ('OG-' || lpad(nextval('seq_codigo_persona')::text, 5, '0')),
  nombres          VARCHAR(80) NOT NULL,
  apellido_paterno VARCHAR(60) NOT NULL,
  apellido_materno VARCHAR(60),
  fecha_nacimiento DATE NOT NULL,
  sexo             CHAR(1) NOT NULL CHECK (sexo IN ('F','M','O')),
  telefono         VARCHAR(15) NOT NULL UNIQUE,
  correo           VARCHAR(120) NOT NULL,
  foto             VARCHAR(255),
  fecha_registro   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ux_persona_correo ON persona (lower(correo));
CREATE INDEX ix_persona_nombre ON persona (apellido_paterno, nombres);

CREATE TABLE cliente (
  id_persona          INT PRIMARY KEY REFERENCES persona (id_persona),
  fecha_alta          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_baja          TIMESTAMP,
  motivo_baja         VARCHAR(250),
  observaciones_acceso VARCHAR(250),
  conducta            VARCHAR(15) NOT NULL DEFAULT 'NORMAL'
                      CHECK (conducta IN ('NORMAL','EN_OBSERVACION','VETADO')),
  estatus             VARCHAR(10) NOT NULL DEFAULT 'ACTIVO' CHECK (estatus IN ('ACTIVO','INACTIVO')),
  CONSTRAINT ck_cliente_baja CHECK (estatus = 'ACTIVO' OR (motivo_baja IS NOT NULL AND fecha_baja IS NOT NULL))
);
CREATE INDEX ix_cliente_estatus ON cliente (estatus);

CREATE TABLE empleado (
  id_persona      INT PRIMARY KEY REFERENCES persona (id_persona),
  fecha_alta      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_baja      TIMESTAMP,
  motivo_baja     VARCHAR(250),
  estatus         VARCHAR(10) NOT NULL DEFAULT 'ACTIVO' CHECK (estatus IN ('ACTIVO','INACTIVO')),
  nombre_usuario  VARCHAR(40) NOT NULL UNIQUE,
  contrasena_hash VARCHAR(255) NOT NULL,
  CONSTRAINT ck_empleado_baja CHECK (estatus = 'ACTIVO' OR (motivo_baja IS NOT NULL AND fecha_baja IS NOT NULL))
);

CREATE TABLE empleado_rol (
  id_persona INT NOT NULL REFERENCES empleado (id_persona),
  id_rol     INT NOT NULL REFERENCES rol (id_rol),
  PRIMARY KEY (id_persona, id_rol)
);

CREATE TABLE contacto_emergencia (
  id_contacto SERIAL PRIMARY KEY,
  id_persona  INT NOT NULL UNIQUE REFERENCES persona (id_persona) ON DELETE CASCADE,
  nombre      VARCHAR(120) NOT NULL,
  telefono    VARCHAR(15) NOT NULL,
  parentesco  VARCHAR(40)
);

-- RE-02: solo plantilla (minucias) cifrada AES-256-GCM; nunca la imagen.
CREATE TABLE plantilla_biometrica (
  id_plantilla          SERIAL PRIMARY KEY,
  id_persona            INT NOT NULL REFERENCES persona (id_persona) ON DELETE CASCADE,
  dedo                  SMALLINT NOT NULL CHECK (dedo BETWEEN 1 AND 10),
  plantilla_cifrada     BYTEA NOT NULL,
  vector_inicializacion BYTEA NOT NULL,
  calidad               SMALLINT NOT NULL CHECK (calidad BETWEEN 70 AND 100),
  fecha_enrolamiento    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  formato_plantilla     VARCHAR(30),
  version_sdk           VARCHAR(30),
  UNIQUE (id_persona, dedo)
);

CREATE TABLE tipo_membresia (
  id_tipo       SERIAL PRIMARY KEY,
  nombre        VARCHAR(60) NOT NULL UNIQUE,
  duracion_dias INT NOT NULL CHECK (duracion_dias > 0),
  precio        NUMERIC(10,2) NOT NULL CHECK (precio >= 0),
  detalles      VARCHAR(250),
  activa        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE membresia_contratada (
  id_membresia SERIAL PRIMARY KEY,
  id_cliente   INT NOT NULL REFERENCES cliente (id_persona),
  id_tipo      INT NOT NULL REFERENCES tipo_membresia (id_tipo),
  fecha_inicio DATE NOT NULL,
  fecha_fin    DATE NOT NULL,
  CHECK (fecha_fin >= fecha_inicio)
);
CREATE INDEX ix_membresia_cliente ON membresia_contratada (id_cliente, fecha_fin);

CREATE TABLE pago (
  id_pago             SERIAL PRIMARY KEY,
  folio_recibo        VARCHAR(20) NOT NULL UNIQUE,
  id_membresia        INT NOT NULL UNIQUE REFERENCES membresia_contratada (id_membresia),
  id_empleado         INT NOT NULL REFERENCES empleado (id_persona),
  fecha_hora          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  monto               NUMERIC(10,2) NOT NULL CHECK (monto >= 0),
  descuento           NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  metodo_pago         VARCHAR(15) NOT NULL CHECK (metodo_pago IN ('EFECTIVO','TARJETA','TRANSFERENCIA')),
  estatus             VARCHAR(10) NOT NULL DEFAULT 'PAGADO' CHECK (estatus IN ('PAGADO','CANCELADO')),
  motivo_cancelacion  VARCHAR(250),
  CONSTRAINT ck_pago_cancel CHECK (estatus = 'PAGADO' OR motivo_cancelacion IS NOT NULL)
);

-- Bitácora append-only: ejecuta un Empleado; afecta (opcionalmente) a una Persona.
CREATE TABLE registro_auditoria (
  id_auditoria        BIGSERIAL PRIMARY KEY,
  id_empleado         INT NOT NULL REFERENCES empleado (id_persona),
  id_persona          INT REFERENCES persona (id_persona),
  fecha_hora          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accion              VARCHAR(40) NOT NULL,
  motivo              VARCHAR(250),
  detalle             VARCHAR(400),
  entidad_afectada    VARCHAR(40),
  id_registro_afectado INT
);
CREATE INDEX ix_auditoria_fecha ON registro_auditoria (fecha_hora);
CREATE INDEX ix_auditoria_persona ON registro_auditoria (id_persona);
CREATE INDEX ix_auditoria_empleado ON registro_auditoria (id_empleado);
