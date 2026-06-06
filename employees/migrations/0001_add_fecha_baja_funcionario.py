from django.db import migrations


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS fecha_baja DATE NULL;",
            reverse_sql="ALTER TABLE funcionario DROP COLUMN IF EXISTS fecha_baja;",
        ),
    ]
