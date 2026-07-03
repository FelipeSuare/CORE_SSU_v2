import sys

from django.core.management.base import BaseCommand

from vacations.models import GestionVacacion
from vacations.utils import aplicar_limite_gestiones_activas, LIMITE_GESTIONES_ACTIVAS


class Command(BaseCommand):
    help = (
        f'Migración única de datos: recorta las gestiones activas de cada funcionario '
        f'a un máximo de {LIMITE_GESTIONES_ACTIVAS}, moviendo el exceso (empezando por '
        f'la gestión más antigua) al nuevo campo dias_perdidos. Ejecutar una sola vez '
        f'después de aplicar la migración de esquema (manage.py migrate).'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--cod',
            type=str,
            help='Procesar solo el funcionario con este código (opcional).',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Muestra qué se evictaría sin aplicar cambios en la base de datos.',
        )

    def handle(self, *args, **options):
        # En Windows, la consola por defecto usa cp1252 y no puede imprimir
        # tildes/flechas; forzar UTF-8 evita un UnicodeEncodeError a mitad
        # de la corrida (que RRHH vería como un crash sin sentido).
        for stream in (sys.stdout, sys.stderr):
            if hasattr(stream, 'reconfigure'):
                stream.reconfigure(encoding='utf-8', errors='replace')

        qs = GestionVacacion.objects.select_related('cod_funcionario__ci')
        if options['cod']:
            qs = qs.filter(cod_funcionario__cod_funcionario=options['cod'])
            if not qs.exists():
                self.stderr.write(self.style.ERROR(f"No se encontró GestionVacacion para el código: {options['cod']}"))
                return

        total = afectados = 0

        for gv in qs:
            total += 1
            f = gv.cod_funcionario
            nombre = f"{f.ci.nombre} {f.ci.ap_paterno}".strip()

            evictadas = aplicar_limite_gestiones_activas(gv)
            if not evictadas:
                continue

            afectados += 1
            detalle = ', '.join(f"gestión {ev['anio']}: {float(ev['dias']):.1f} días" for ev in evictadas)

            if options['dry_run']:
                self.stdout.write(f'  [DRY-RUN] {nombre} ({f.cod_funcionario}): pasarían a perdidos → {detalle}')
                continue

            gv.save(update_fields=[
                'dias_perdidos',
                *(f"anio_gestion{ev['slot']}" for ev in evictadas),
                *(f"dias_gestion{ev['slot']}" for ev in evictadas),
            ])
            self.stdout.write(self.style.SUCCESS(f'  OK {nombre} ({f.cod_funcionario}): pasaron a perdidos → {detalle}'))

        self.stdout.write('')
        modo = 'DRY-RUN (sin cambios aplicados)' if options['dry_run'] else 'APLICADO'
        self.stdout.write(self.style.SUCCESS(
            f'Listo [{modo}]. Total funcionarios revisados: {total} | Con exceso de gestiones: {afectados}'
        ))
