from django.db import migrations


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE gestion_vacacion ADD COLUMN IF NOT EXISTS dias_perdidos NUMERIC(4,1) NOT NULL DEFAULT 0;",
            reverse_sql="ALTER TABLE gestion_vacacion DROP COLUMN IF EXISTS dias_perdidos;",
        ),
    ]
