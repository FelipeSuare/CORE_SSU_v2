from django.db import models

class Persona(models.Model):
    ci = models.CharField(primary_key=True, max_length=20)
    nombre = models.CharField(max_length=50)
    ap_paterno = models.CharField(max_length=50)
    ap_materno = models.CharField(max_length=50, blank=True, null=True)
    fecha_nacimiento = models.DateField()
    sexo = models.CharField(max_length=10, choices=[('Masculino', 'Masculino'), ('Femenino', 'Femenino')])
    foto = models.BinaryField(blank=True, null=True)

    class Meta:
        db_table = 'persona'
        managed = False

class Funcionario(models.Model):
    cod_funcionario = models.CharField(primary_key=True, max_length=20)
    ci = models.OneToOneField(Persona, models.CASCADE, db_column='ci')
    matricula_seguro = models.CharField(max_length=20, unique=True, blank=True, null=True)
    id_unidad = models.ForeignKey('core.UnidadOrganizacional', models.DO_NOTHING, db_column='id_unidad')
    fecha_ingreso = models.DateField()
    tipo_funcionario = models.CharField(max_length=25, choices=[
        ('PERSONAL DE AREA',      'PERSONAL DE AREA'),
        ('JEFE AREA',             'JEFE AREA'),
        ('DEPENDENCIA DIRECTA',   'DEPENDENCIA DIRECTA'),
        ('GERENTE ADMINISTRATIVO','GERENTE ADMINISTRATIVO'),
        ('GERENTE SALUD',         'GERENTE SALUD'),
        ('GERENTE GENERAL',       'GERENTE GENERAL'),
    ])
    estado = models.CharField(max_length=10, default='ACTIVO')
    fecha_baja = models.DateField(blank=True, null=True)
    contrasena_hash = models.CharField(max_length=255)
    fecha_registro = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'funcionario'
        managed = False

class HistorialCargo(models.Model):
    id_historial = models.AutoField(primary_key=True)
    cod_funcionario = models.ForeignKey(Funcionario, models.CASCADE, db_column='cod_funcionario')
    cargo = models.CharField(max_length=100)
    tipo_contrato = models.CharField(max_length=30)
    fecha_inicio = models.DateField()
    fecha_fin = models.DateField(blank=True, null=True)
    es_actual = models.BooleanField(default=True)
    saldo_gestion1_al_salir = models.DecimalField(max_digits=4, decimal_places=1, blank=True, null=True)
    anio_gestion1_al_salir  = models.IntegerField(blank=True, null=True)
    saldo_gestion2_al_salir = models.DecimalField(max_digits=4, decimal_places=1, blank=True, null=True)
    anio_gestion2_al_salir  = models.IntegerField(blank=True, null=True)
    saldo_gestion3_al_salir = models.DecimalField(max_digits=4, decimal_places=1, blank=True, null=True)
    anio_gestion3_al_salir  = models.IntegerField(blank=True, null=True)
    saldo_gestion4_al_salir = models.DecimalField(max_digits=4, decimal_places=1, blank=True, null=True)
    anio_gestion4_al_salir  = models.IntegerField(blank=True, null=True)

    class Meta:
        db_table = 'historial_cargo'
        managed = False
