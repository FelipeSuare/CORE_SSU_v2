from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('employees', '0001_add_fecha_baja_funcionario'),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
                ALTER TABLE funcionario
                    DROP CONSTRAINT IF EXISTS funcionario_tipo_funcionario_check;

                ALTER TABLE funcionario
                    ALTER COLUMN tipo_funcionario TYPE VARCHAR(25);

                UPDATE funcionario SET tipo_funcionario = 'PERSONAL DE AREA'
                    WHERE tipo_funcionario = 'SUBORDINADO';
                UPDATE funcionario SET tipo_funcionario = 'JEFE AREA'
                    WHERE tipo_funcionario = 'JEFE_AREA';
                UPDATE funcionario SET tipo_funcionario = 'DEPENDENCIA DIRECTA'
                    WHERE tipo_funcionario = 'DEPENDENCIA_DIRECTA';
                UPDATE funcionario SET tipo_funcionario = 'GERENTE ADMINISTRATIVO'
                    WHERE tipo_funcionario = 'GERENTE_ADMINISTRATIVO';
                UPDATE funcionario SET tipo_funcionario = 'GERENTE SALUD'
                    WHERE tipo_funcionario = 'GERENTE_SALUD';
                UPDATE funcionario SET tipo_funcionario = 'GERENTE GENERAL'
                    WHERE tipo_funcionario = 'GERENTE_GENERAL';

                ALTER TABLE funcionario
                    ADD CONSTRAINT funcionario_tipo_funcionario_check
                    CHECK (tipo_funcionario IN (
                        'PERSONAL DE AREA',
                        'JEFE AREA',
                        'DEPENDENCIA DIRECTA',
                        'GERENTE ADMINISTRATIVO',
                        'GERENTE SALUD',
                        'GERENTE GENERAL'
                    ));
            """,
            reverse_sql="""
                ALTER TABLE funcionario
                    DROP CONSTRAINT IF EXISTS funcionario_tipo_funcionario_check;

                UPDATE funcionario SET tipo_funcionario = 'SUBORDINADO'
                    WHERE tipo_funcionario = 'PERSONAL DE AREA';
                UPDATE funcionario SET tipo_funcionario = 'JEFE_AREA'
                    WHERE tipo_funcionario = 'JEFE AREA';
                UPDATE funcionario SET tipo_funcionario = 'DEPENDENCIA_DIRECTA'
                    WHERE tipo_funcionario = 'DEPENDENCIA DIRECTA';
                UPDATE funcionario SET tipo_funcionario = 'GERENTE_ADMINISTRATIVO'
                    WHERE tipo_funcionario = 'GERENTE ADMINISTRATIVO';
                UPDATE funcionario SET tipo_funcionario = 'GERENTE_SALUD'
                    WHERE tipo_funcionario = 'GERENTE SALUD';
                UPDATE funcionario SET tipo_funcionario = 'GERENTE_GENERAL'
                    WHERE tipo_funcionario = 'GERENTE GENERAL';

                ALTER TABLE funcionario
                    ALTER COLUMN tipo_funcionario TYPE VARCHAR(20);

                ALTER TABLE funcionario
                    ADD CONSTRAINT funcionario_tipo_funcionario_check
                    CHECK (tipo_funcionario IN (
                        'SUBORDINADO', 'JEFE_AREA', 'DEPENDENCIA_DIRECTA',
                        'GERENTE_ADMINISTRATIVO', 'GERENTE_SALUD', 'GERENTE_GENERAL'
                    ));
            """,
        ),
    ]
