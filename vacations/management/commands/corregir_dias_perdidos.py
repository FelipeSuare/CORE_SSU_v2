import sys
from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Sum

from employees.models import Funcionario
from vacations.models import AnulacionAjuste, GestionVacacion, SolicitudVacacion
from vacations.utils import (
    calcular_anios_antiguedad, calcular_gestioneS_pendientes, dias_por_antiguedad, gestiones_ocupadas,
)

# Fecha en que se introdujo el tope de 2 gestiones (476a6db): las gestiones
# perdidas se cuentan desde la ventana de 4 años vigente ese día.
FECHA_TOPE_GESTIONES = date(2026, 7, 2)
CERO = Decimal('0')


def dias_perdidos_esperados(f, gv) -> Decimal:
    """
    Conservación de días: lo asignado desde la ventana inicial hasta la gestión
    más reciente, menos el saldo activo, menos lo consumido neto (solicitudes
    no rechazadas, menos lo devuelto por anulaciones/ajustes).
    """
    ocupadas = gestiones_ocupadas(gv)
    if not ocupadas:
        return gv.dias_perdidos or CERO
    ventana = calcular_gestioneS_pendientes(f.fecha_ingreso, FECHA_TOPE_GESTIONES)
    desde = ventana[0][1] if ventana else ocupadas[0][1]
    asignado = sum(
        (dias_por_antiguedad(calcular_anios_antiguedad(f.fecha_ingreso, date(a, 12, 31)))
         for a in range(desde, ocupadas[-1][1] + 1)),
        CERO,
    )
    activo = sum((d for _, _, d in ocupadas), CERO)
    sols = SolicitudVacacion.objects.filter(cod_funcionario=f).exclude(estado__in=('RECHAZADA', 'RECHAZADO'))
    consumido = (
        (sols.aggregate(s=Sum('dias_solicitados'))['s'] or CERO)
        - (AnulacionAjuste.objects.filter(id_formulario__cod_funcionario=f)
           .aggregate(s=Sum('dias_devolver'))['s'] or CERO)
    )
    return max(asignado - activo - consumido, CERO)


class Command(BaseCommand):
    help = (
        'Corrige dias_perdidos inflado por el bug del signal _auto_poblar_vacaciones '
        '(reset+repoblar repetido en cada reinicio del servidor). Recalcula por '
        'conservación de días y solo BAJA dias_perdidos cuando supera el valor '
        'esperado; nunca toca los saldos de las gestiones activas.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        for stream in (sys.stdout, sys.stderr):
            if hasattr(stream, 'reconfigure'):
                stream.reconfigure(encoding='utf-8', errors='replace')

        corregidos = 0
        with transaction.atomic():
            for gv in (GestionVacacion.objects.select_for_update()
                       .filter(cod_funcionario__estado='ACTIVO')
                       .select_related('cod_funcionario__ci')):
                f = gv.cod_funcionario
                actual = gv.dias_perdidos or CERO
                esperado = dias_perdidos_esperados(f, gv)
                # Solo inflados: un valor menor puede venir de una acreditación
                # posterior a la ventana inicial y no se puede reconstruir.
                if actual <= esperado:
                    continue

                corregidos += 1
                detalle = f'{f.ci.nombre} {f.ci.ap_paterno} ({f.cod_funcionario}): {float(actual)} -> {float(esperado)}'
                if options['dry_run']:
                    self.stdout.write(f'  [DRY-RUN] {detalle}')
                    continue

                gv.dias_perdidos = esperado
                gv.save(update_fields=['dias_perdidos'])
                self.stdout.write(self.style.SUCCESS(f'  OK {detalle}'))

        modo = 'DRY-RUN (sin cambios aplicados)' if options['dry_run'] else 'APLICADO'
        self.stdout.write(self.style.SUCCESS(f'Listo [{modo}]. Funcionarios corregidos: {corregidos}'))
