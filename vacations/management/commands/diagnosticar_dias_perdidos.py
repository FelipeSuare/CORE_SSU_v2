import sys
from decimal import Decimal

from django.core.management.base import BaseCommand

from employees.models import Funcionario
from vacations.models import GestionVacacion, SolicitudVacacion
from vacations.utils import calcular_gestioneS_pendientes, LIMITE_GESTIONES_ACTIVAS


class Command(BaseCommand):
    help = 'Diagnostico de solo lectura: compara dias_perdidos actual contra el valor correcto recalculado desde cero.'

    def handle(self, *args, **options):
        for stream in (sys.stdout, sys.stderr):
            if hasattr(stream, 'reconfigure'):
                stream.reconfigure(encoding='utf-8', errors='replace')

        funcionarios = Funcionario.objects.filter(estado='ACTIVO').select_related('ci')
        gestiones_map = {
            gv.cod_funcionario_id: gv
            for gv in GestionVacacion.objects.filter(cod_funcionario__in=funcionarios)
        }

        total = 0
        sin_aprobada_con_gv = 0
        discrepancias = []

        for f in funcionarios:
            gv = gestiones_map.get(f.cod_funcionario)
            if not gv:
                continue
            total += 1

            tiene_aprobada = SolicitudVacacion.objects.filter(cod_funcionario=f, estado='APROBADA').exists()
            if tiene_aprobada:
                continue

            sin_aprobada_con_gv += 1

            esperadas = calcular_gestioneS_pendientes(f.fecha_ingreso)
            n = len(esperadas)
            if n <= LIMITE_GESTIONES_ACTIVAS:
                correcto_perdidos = Decimal('0')
                activos_correctos = [(a, d) for _, a, d in esperadas]
            else:
                excedentes = esperadas[: n - LIMITE_GESTIONES_ACTIVAS]
                activos = esperadas[n - LIMITE_GESTIONES_ACTIVAS:]
                correcto_perdidos = sum((d for _, _, d in excedentes), Decimal('0'))
                activos_correctos = [(a, d) for _, a, d in activos]

            actual_perdidos = gv.dias_perdidos or Decimal('0')
            if actual_perdidos != correcto_perdidos:
                p = f.ci
                discrepancias.append({
                    'cod': f.cod_funcionario,
                    'nombre': f"{p.nombre} {p.ap_paterno}".strip(),
                    'actual': float(actual_perdidos),
                    'correcto': float(correcto_perdidos),
                    'activos_correctos': activos_correctos,
                })

        self.stdout.write(f'Funcionarios activos con GestionVacacion: {total}')
        self.stdout.write(f'Sin solicitud aprobada nunca: {sin_aprobada_con_gv}')
        self.stdout.write(f'Con discrepancia real (dias_perdidos incorrecto): {len(discrepancias)}')
        self.stdout.write('')
        for d in discrepancias:
            self.stdout.write(
                f"  {d['nombre']} ({d['cod']}): actual={d['actual']} -> correcto={d['correcto']}  | activos correctos: {d['activos_correctos']}"
            )
