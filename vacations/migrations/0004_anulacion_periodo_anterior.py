from django.db import migrations


class Migration(migrations.Migration):
    """
    Anulación parcial por fechas: la solicitud pasa a tener el nuevo período y
    aquí se conserva el período que tenía antes del ajuste (auditoría).
    """

    dependencies = [
        ('vacations', '0003_acuerdo_vacacion_v2'),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
                ALTER TABLE anulacion_ajuste
                    ADD COLUMN IF NOT EXISTS fecha_salida_anterior  DATE NULL,
                    ADD COLUMN IF NOT EXISTS fecha_retorno_anterior DATE NULL;
            """,
            reverse_sql="""
                ALTER TABLE anulacion_ajuste
                    DROP COLUMN IF EXISTS fecha_salida_anterior,
                    DROP COLUMN IF EXISTS fecha_retorno_anterior;
            """,
        ),
    ]
