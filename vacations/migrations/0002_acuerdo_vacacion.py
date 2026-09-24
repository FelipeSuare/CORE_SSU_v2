from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('vacations', '0001_add_dias_perdidos_gestion'),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
                CREATE TABLE IF NOT EXISTS acuerdo_vacacion (
                    id_acuerdo      SERIAL PRIMARY KEY,
                    tipo            VARCHAR(10) NOT NULL CHECK (tipo IN ('COLECTIVO', 'RECHAZO')),
                    nro_documento   VARCHAR(60) NULL,
                    motivo          TEXT NOT NULL,
                    fecha_acuerdo   DATE NOT NULL,
                    fecha_hasta     DATE NOT NULL,
                    id_formulario   INTEGER NULL REFERENCES solicitud_vacacion(id_formulario),
                    registrado_por  VARCHAR(20) NULL REFERENCES funcionario(cod_funcionario),
                    fecha_registro  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                    activo          BOOLEAN NOT NULL DEFAULT TRUE
                );
                CREATE TABLE IF NOT EXISTS acuerdo_vacacion_funcionario (
                    id               SERIAL PRIMARY KEY,
                    id_acuerdo       INTEGER NOT NULL REFERENCES acuerdo_vacacion(id_acuerdo) ON DELETE CASCADE,
                    cod_funcionario  VARCHAR(20) NOT NULL REFERENCES funcionario(cod_funcionario) ON DELETE CASCADE,
                    anio_gestion     INTEGER NOT NULL,
                    UNIQUE (id_acuerdo, cod_funcionario, anio_gestion)
                );
                CREATE INDEX IF NOT EXISTS idx_acuerdo_vac_func_cod
                    ON acuerdo_vacacion_funcionario (cod_funcionario);
            """,
            reverse_sql="""
                DROP TABLE IF EXISTS acuerdo_vacacion_funcionario;
                DROP TABLE IF EXISTS acuerdo_vacacion;
            """,
        ),
    ]
