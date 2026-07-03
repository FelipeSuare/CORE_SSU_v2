import sys
from decimal import Decimal

from django.core.management.base import BaseCommand

from employees.models import Funcionario
from vacations.models import GestionVacacion, SolicitudVacacion
from vacations.utils import calcular_gestioneS_pendientes, LIMITE_GESTIONES_ACTIVAS


class Command(BaseCommand):
    help = (
        'Corrige dias_perdidos inflado por el bug del signal _auto_poblar_vacaciones '
        '(reset+repoblar repetido en cada reinicio del servidor). Recalcula desde '
        'cero usando calcular_gestioneS_pendientes y FIJA (no suma) el valor '
        'correcto de dias_perdidos y de las 2 gestiones activas. Solo toca '
        'funcionarios sin ninguna solicitud APROBADA (los unicos que el bug pudo '
        'haber afectado; los demas nunca fueron tocados por el signal).'
    )

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        for stream in (sys.stdout, sys.stderr):
            if hasattr(stream, 'reconfigure'):
                stream.reconfigure(encoding='utf-8', errors='replace')

        funcionarios = Funcionario.objects.filter(estado='ACTIVO').select_related('ci')
        gestiones_map = {
            gv.cod_funcionario_id: gv
            for gv in GestionVacacion.objects.filter(cod_funcionario__in=funcionarios)
        }

        corregidos = 0

        for f in funcionarios:
            gv = gestiones_map.get(f.cod_funcionario)
            if not gv:
                continue

            if SolicitudVacacion.objects.filter(cod_funcionario=f, estado='APROBADA').exists():
                continue  # el bug nunca tocó a estos funcionarios

            esperadas = calcular_gestioneS_pendientes(f.fecha_ingreso)
            n = len(esperadas)
            if n <= LIMITE_GESTIONES_ACTIVAS:
                correcto_perdidos = Decimal('0')
                activos = list(esperadas)
            else:
                excedentes = esperadas[: n - LIMITE_GESTIONES_ACTIVAS]
                activos = esperadas[n - LIMITE_GESTIONES_ACTIVAS:]
                correcto_perdidos = sum((d for _, _, d in excedentes), Decimal('0'))

            actual_perdidos = gv.dias_perdidos or Decimal('0')

            # Estado actual de los 4 slots físicos, para comparar también los activos
            actuales = {
                getattr(gv, f'anio_gestion{i}'): (i, getattr(gv, f'dias_gestion{i}'))
                for i in range(1, 5)
                if getattr(gv, f'anio_gestion{i}') is not None
            }
            activos_correctos = {anio: dias for _, anio, dias in activos}

            necesita_fix = (actual_perdidos != correcto_perdidos) or (
                set(actuales.keys()) != set(activos_correctos.keys())
            )
            if not necesita_fix:
                continue

            corregidos += 1
            p = f.ci
            nombre = f"{p.nombre} {p.ap_paterno}".strip()
            detalle = f"dias_perdidos: {float(actual_perdidos)} -> {float(correcto_perdidos)} | activos: {sorted(activos_correctos.items())}"

            if options['dry_run']:
                self.stdout.write(f'  [DRY-RUN] {nombre} ({f.cod_funcionario}): {detalle}')
                continue

            for i in range(1, 5):
                setattr(gv, f'anio_gestion{i}', None)
                setattr(gv, f'dias_gestion{i}', Decimal('0'))
            for idx, (_, anio, dias) in enumerate(reversed(activos), start=1):
                setattr(gv, f'anio_gestion{idx}', anio)
                setattr(gv, f'dias_gestion{idx}', dias)
            gv.dias_perdidos = correcto_perdidos

            gv.save(update_fields=[
                'anio_gestion1', 'dias_gestion1',
                'anio_gestion2', 'dias_gestion2',
                'anio_gestion3', 'dias_gestion3',
                'anio_gestion4', 'dias_gestion4',
                'dias_perdidos',
            ])
            self.stdout.write(self.style.SUCCESS(f'  OK {nombre} ({f.cod_funcionario}): {detalle}'))

        self.stdout.write('')
        modo = 'DRY-RUN (sin cambios aplicados)' if options['dry_run'] else 'APLICADO'
        self.stdout.write(self.style.SUCCESS(f'Listo [{modo}]. Funcionarios corregidos: {corregidos}'))
