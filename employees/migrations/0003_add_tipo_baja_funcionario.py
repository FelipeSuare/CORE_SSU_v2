from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('employees', '0002_rename_tipo_funcionario_values'),
    ]

    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS tipo_baja VARCHAR(10) NULL;",
            reverse_sql="ALTER TABLE funcionario DROP COLUMN IF EXISTS tipo_baja;",
        ),
    ]
