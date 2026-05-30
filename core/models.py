from django.db import models

class UnidadOrganizacional(models.Model):
    id_unidad = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=100, unique=True)
    descripcion = models.CharField(max_length=255, blank=True, null=True)
    activo = models.BooleanField(default=True)

    class Meta:
        db_table = 'unidad_organizacional'
        managed = False

class Feriado(models.Model):
    TIPO_CHOICES = [
        ('Internacional', 'Internacional'),
        ('Nacional', 'Nacional'),
        ('Departamental', 'Departamental'),
        ('Municipal', 'Municipal'),
        ('Institucional', 'Institucional'),
    ]
    id_feriado = models.AutoField(primary_key=True)
    fecha = models.DateField(unique=True)
    descripcion = models.CharField(max_length=100)
    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES)

    class Meta:
        db_table = 'feriado'
        managed = False
