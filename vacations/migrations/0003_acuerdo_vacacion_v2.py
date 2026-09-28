from django.db import migrations


class Migration(migrations.Migration):
    """
    Acuerdos v2: N.° RA-XX/AAAA autogenerado, tipos COLECTIVO/INDIVIDUAL,
    estado VIGENTE/ANULADO/MODIFICADO con trazabilidad, autorizado_por y
    días protegidos (foto al registrar).
    """

    dependencies = [
        ('vacations', '0002_acuerdo_vacacion'),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
                ALTER TABLE acuerdo_vacacion
                    ADD COLUMN anio_nro          INTEGER NULL,
                    ADD COLUMN correlativo       INTEGER NULL,
                    ADD COLUMN estado            VARCHAR(10) NOT NULL DEFAULT 'VIGENTE',
                    ADD COLUMN autorizado_por    VARCHAR(20) NULL REFERENCES funcionario(cod_funcionario),
                    ADD COLUMN reemplazado_por   INTEGER NULL REFERENCES acuerdo_vacacion(id_acuerdo),
                    ADD COLUMN motivo_anulacion  TEXT NULL,
                    ADD COLUMN anulado_por       VARCHAR(20) NULL REFERENCES funcionario(cod_funcionario),
                    ADD COLUMN fecha_anulacion   TIMESTAMP WITH TIME ZONE NULL;

                UPDATE acuerdo_vacacion SET estado = CASE WHEN activo THEN 'VIGENTE' ELSE 'ANULADO' END;

                -- Numeración RA de los colectivos existentes, por año de registro.
                UPDATE acuerdo_vacacion a SET anio_nro = n.anio, correlativo = n.num
                FROM (
                    SELECT id_acuerdo,
                           EXTRACT(YEAR FROM fecha_registro)::int AS anio,
                           ROW_NUMBER() OVER (
                               PARTITION BY EXTRACT(YEAR FROM fecha_registro)
                               ORDER BY fecha_registro, id_acuerdo
                           ) AS num
                    FROM acuerdo_vacacion WHERE tipo = 'COLECTIVO'
                ) n
                WHERE a.id_acuerdo = n.id_acuerdo;

                ALTER TABLE acuerdo_vacacion
                    DROP COLUMN activo,
                    DROP COLUMN nro_documento,
                    DROP CONSTRAINT IF EXISTS acuerdo_vacacion_tipo_check,
                    ADD CONSTRAINT acuerdo_vacacion_tipo_check
                        CHECK (tipo IN ('COLECTIVO', 'INDIVIDUAL', 'RECHAZO')),
                    ADD CONSTRAINT acuerdo_vacacion_estado_check
                        CHECK (estado IN ('VIGENTE', 'ANULADO', 'MODIFICADO')),
                    ADD CONSTRAINT acuerdo_vacacion_nro_uniq UNIQUE (anio_nro, correlativo);

                ALTER TABLE acuerdo_vacacion_funcionario
                    ADD COLUMN dias_protegidos NUMERIC(4,1) NOT NULL DEFAULT 0;

                -- Foto de días desde el slot actual de cada gestión protegida.
                UPDATE acuerdo_vacacion_funcionario avf SET dias_protegidos = CASE avf.anio_gestion
                        WHEN gv.anio_gestion1 THEN gv.dias_gestion1
                        WHEN gv.anio_gestion2 THEN gv.dias_gestion2
                        WHEN gv.anio_gestion3 THEN gv.dias_gestion3
                        WHEN gv.anio_gestion4 THEN gv.dias_gestion4
                        ELSE 0 END
                FROM gestion_vacacion gv
                WHERE gv.cod_funcionario = avf.cod_funcionario;
            """,
            reverse_sql="""
                ALTER TABLE acuerdo_vacacion_funcionario DROP COLUMN dias_protegidos;
                ALTER TABLE acuerdo_vacacion
                    ADD COLUMN activo BOOLEAN NOT NULL DEFAULT TRUE,
                    ADD COLUMN nro_documento VARCHAR(60) NULL;
                UPDATE acuerdo_vacacion SET activo = (estado = 'VIGENTE'),
                    nro_documento = CASE WHEN correlativo IS NULL THEN NULL
                                         ELSE 'RA-' || LPAD(correlativo::text, 2, '0') || '/' || anio_nro END;
                DELETE FROM acuerdo_vacacion WHERE tipo = 'INDIVIDUAL';
                ALTER TABLE acuerdo_vacacion
                    DROP CONSTRAINT acuerdo_vacacion_nro_uniq,
                    DROP CONSTRAINT acuerdo_vacacion_estado_check,
                    DROP CONSTRAINT acuerdo_vacacion_tipo_check,
                    ADD CONSTRAINT acuerdo_vacacion_tipo_check CHECK (tipo IN ('COLECTIVO', 'RECHAZO')),
                    DROP COLUMN fecha_anulacion,
                    DROP COLUMN anulado_por,
                    DROP COLUMN motivo_anulacion,
                    DROP COLUMN reemplazado_por,
                    DROP COLUMN autorizado_por,
                    DROP COLUMN estado,
                    DROP COLUMN correlativo,
                    DROP COLUMN anio_nro;
            """,
        ),
    ]
