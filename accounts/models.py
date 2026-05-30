from django.db import models

class Roles(models.Model):
    id_roles = models.AutoField(primary_key=True)
    tipo_rol = models.CharField(max_length=50, unique=True)
    descripcion = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        db_table = 'roles'
        managed = False

class FuncionarioRol(models.Model):
    id_func_rol = models.AutoField(primary_key=True)
    cod_funcionario = models.ForeignKey('employees.Funcionario', models.CASCADE, db_column='cod_funcionario', related_name='roles_asignados')
    id_roles = models.ForeignKey(Roles, models.DO_NOTHING, db_column='id_roles')
    fecha_asignacion = models.DateField(auto_now_add=True)
    fecha_revocacion = models.DateField(blank=True, null=True)
    activo = models.BooleanField(default=True)
    asignado_por = models.ForeignKey('employees.Funcionario', models.DO_NOTHING, db_column='asignado_por', blank=True, null=True, related_name='roles_dados')

    class Meta:
        db_table = 'funcionario_rol'
        managed = False
