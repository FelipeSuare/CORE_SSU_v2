import sys
from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from vacations.models import GestionVacacion
from vacations.utils import anios_protegidos, calcular_anios_antiguedad, dias_por_antiguedad, gestiones_ocupadas


class Command(BaseCommand):
    help = (
        'Corrige saldos consumidos fuera de orden por el descuento antiguo por '
        'número de slot (4→1): si la gestión más antigua estaba en un slot menor, '
        'se descontaba primero la más reciente. Redistribuye el MISMO saldo total '
        'como si se hubiera descontado de la más antigua a la reciente. No toca '
        'gestiones protegidas por acuerdo (esas se consumen primero a propósito).'
    )

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        for stream in (sys.stdout, sys.stderr):
            if hasattr(stream, 'reconfigure'):
                stream.reconfigure(encoding='utf-8', errors='replace')

        corregidos = 0
        with transaction.atomic():
            for gv in GestionVacacion.objects.select_for_update().select_related('cod_funcionario'):
                f = gv.cod_funcionario
                ocupadas = gestiones_ocupadas(gv, anios_protegidos(f.cod_funcionario))  # año ascendente
                if len(ocupadas) < 2:
                    continue

                # Saldo restante = asignación de cada año menos lo consumido en
                # orden correcto: las recientes quedan llenas, el resto queda en
                # la más antigua.
                restante = sum((d for _, _, d in ocupadas), Decimal('0'))
                nuevos = {}
                for slot, anio, _ in reversed(ocupadas[1:]):
                    tope = dias_por_antiguedad(calcular_anios_antiguedad(f.fecha_ingreso, date(anio, 12, 31)))
                    nuevos[slot] = min(tope, restante)
                    restante -= nuevos[slot]
                nuevos[ocupadas[0][0]] = restante

                if all(nuevos[slot] == dias for slot, _, dias in ocupadas):
                    continue

                corregidos += 1
                antes = [(anio, float(d)) for _, anio, d in ocupadas]
                despues = [(anio, float(nuevos[slot])) for slot, anio, _ in ocupadas]
                detalle = f'{f.cod_funcionario}: {antes} -> {despues}'
                if options['dry_run']:
                    self.stdout.write(f'  [DRY-RUN] {detalle}')
                    continue

                for slot, dias in nuevos.items():
                    setattr(gv, f'dias_gestion{slot}', dias)
                gv.save(update_fields=[f'dias_gestion{slot}' for slot in nuevos])
                self.stdout.write(self.style.SUCCESS(f'  OK {detalle}'))

        modo = 'DRY-RUN (sin cambios aplicados)' if options['dry_run'] else 'APLICADO'
        self.stdout.write(self.style.SUCCESS(f'Listo [{modo}]. Funcionarios corregidos: {corregidos}'))
