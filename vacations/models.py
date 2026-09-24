from decimal import Decimal
from django.db import models
from django.db.models import Value
from django.db.models.functions import Coalesce

class JerarquiaAprobacion(models.Model):
    id_jerarquia = models.AutoField(primary_key=True)
    cod_funcionario = models.ForeignKey('employees.Funcionario', models.DO_NOTHING, db_column='cod_funcionario', related_name='aprobadores')
    cod_aprobador = models.ForeignKey('employees.Funcionario', models.DO_NOTHING, db_column='cod_aprobador', related_name='es_aprobador_de')
    nivel_aprobacion = models.IntegerField()
    fecha_inicio = models.DateField(auto_now_add=True)
    fecha_fin = models.DateField(blank=True, null=True)
    activo = models.BooleanField(default=True)

    class Meta:
        db_table = 'jerarquia_aprobacion'
        managed = False

class GestionVacacion(models.Model):
    id_gestion = models.AutoField(primary_key=True)
    cod_funcionario = models.OneToOneField('employees.Funcionario', models.CASCADE, db_column='cod_funcionario')
    dias_gestion1 = models.DecimalField(max_digits=4, decimal_places=1, default=0)
    anio_gestion1 = models.IntegerField(blank=True, null=True)
    dias_gestion2 = models.DecimalField(max_digits=4, decimal_places=1, default=0)
    anio_gestion2 = models.IntegerField(blank=True, null=True)
    dias_gestion3 = models.DecimalField(max_digits=4, decimal_places=1, default=0)
    anio_gestion3 = models.IntegerField(blank=True, null=True)
    dias_gestion4 = models.DecimalField(max_digits=4, decimal_places=1, default=0)
    anio_gestion4 = models.IntegerField(blank=True, null=True)
    dias_negados = models.DecimalField(max_digits=4, decimal_places=1, default=0)
    dias_perdidos = models.DecimalField(max_digits=4, decimal_places=1, default=0)
    dias_adeudados = models.GeneratedField(
        expression=(
            Coalesce('dias_gestion1', Value(Decimal('0'))) +
            Coalesce('dias_gestion2', Value(Decimal('0'))) +
            Coalesce('dias_gestion3', Value(Decimal('0'))) +
            Coalesce('dias_gestion4', Value(Decimal('0')))
        ),
        output_field=models.DecimalField(max_digits=4, decimal_places=1),
        db_persist=True,
    )

    class Meta:
        db_table = 'gestion_vacacion'
        managed = False

class SolicitudVacacion(models.Model):
    id_formulario = models.AutoField(primary_key=True)
    cod_funcionario = models.ForeignKey('employees.Funcionario', models.DO_NOTHING, db_column='cod_funcionario')
    fecha_solicitud = models.DateField(auto_now_add=True)
    fecha_salida = models.DateField()
    fecha_retorno = models.DateField()
    dias_solicitados = models.DecimalField(max_digits=4, decimal_places=1)
    motivo_vacacion = models.TextField(blank=True, null=True)
    estado = models.CharField(max_length=30, default='PENDIENTE_JEFE')
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'solicitud_vacacion'
        managed = False

class AprobacionSolicitud(models.Model):
    id_aprobacion = models.AutoField(primary_key=True)
    id_formulario = models.ForeignKey(SolicitudVacacion, models.CASCADE, db_column='id_formulario')
    cod_aprobador = models.ForeignKey('employees.Funcionario', models.DO_NOTHING, db_column='cod_aprobador')
    nivel = models.IntegerField()
    decision = models.CharField(max_length=10)
    fecha_decision = models.DateTimeField(auto_now_add=True)
    observacion = models.TextField(blank=True, null=True)

    class Meta:
        db_table = 'aprobacion_solicitud'
        managed = False

class AnulacionAjuste(models.Model):
    id_anulacion_ajuste = models.AutoField(primary_key=True)
    id_formulario = models.ForeignKey(SolicitudVacacion, models.DO_NOTHING, db_column='id_formulario')
    tipo_anulacion = models.CharField(max_length=10)
    motivo_anulacion = models.TextField()
    observaciones = models.TextField(blank=True, null=True)
    dias_devolver = models.DecimalField(max_digits=4, decimal_places=1, default=0)
    fecha_registro = models.DateTimeField(auto_now_add=True)
    registrado_por = models.ForeignKey('employees.Funcionario', models.DO_NOTHING, db_column='registrado_por', blank=True, null=True)

    class Meta:
        db_table = 'anulacion_ajuste'
        managed = False

class AcuerdoVacacion(models.Model):
    """
    Excepción a la pérdida por tope de gestiones activas. Mientras esté activo
    y vigente (fecha_hasta >= hoy), las gestiones listadas en
    AcuerdoVacacionFuncionario no se evictan a dias_perdidos.
      COLECTIVO: registrado por RRHH con respaldo documental (ej. pandemia).
      RECHAZO:   generado por el sistema al rechazar una solicitud hecha
                 cerca de la fecha límite de la gestión más antigua.
    """
    id_acuerdo = models.AutoField(primary_key=True)
    tipo = models.CharField(max_length=10)
    nro_documento = models.CharField(max_length=60, blank=True, null=True)
    motivo = models.TextField()
    fecha_acuerdo = models.DateField()
    fecha_hasta = models.DateField()
    id_formulario = models.ForeignKey(SolicitudVacacion, models.DO_NOTHING, db_column='id_formulario', blank=True, null=True)
    registrado_por = models.ForeignKey('employees.Funcionario', models.DO_NOTHING, db_column='registrado_por', blank=True, null=True, related_name='+')
    fecha_registro = models.DateTimeField(auto_now_add=True)
    activo = models.BooleanField(default=True)

    class Meta:
        db_table = 'acuerdo_vacacion'
        managed = False

class AcuerdoVacacionFuncionario(models.Model):
    id_acuerdo = models.ForeignKey(AcuerdoVacacion, models.CASCADE, db_column='id_acuerdo', related_name='afectados')
    cod_funcionario = models.ForeignKey('employees.Funcionario', models.CASCADE, db_column='cod_funcionario', related_name='+')
    anio_gestion = models.IntegerField()

    class Meta:
        db_table = 'acuerdo_vacacion_funcionario'
        managed = False
        unique_together = (('id_acuerdo', 'cod_funcionario', 'anio_gestion'),)
