from django.apps import AppConfig


class VacationsConfig(AppConfig):
    name = 'vacations'

    def ready(self):
        from django.db.models.signals import post_migrate
        post_migrate.connect(_auto_poblar_vacaciones, sender=self)


def _auto_poblar_vacaciones(sender, **kwargs):
    """
    Se ejecuta automáticamente después de 'manage.py migrate'.
    Calcula y acredita los días de vacación a todos los funcionarios activos
    que aún no tengan gestiones registradas.
    """
    try:
        from employees.models import Funcionario
        from vacations.models import GestionVacacion
        from vacations.utils import poblar_gestion_vacacion

        for f in Funcionario.objects.filter(estado='ACTIVO'):
            try:
                gv = GestionVacacion.objects.get(cod_funcionario=f)
                ya_tiene_datos = any(
                    getattr(gv, f'anio_gestion{i}') is not None
                    for i in range(1, 5)
                )
                if not ya_tiene_datos:
                    poblar_gestion_vacacion(f)
            except GestionVacacion.DoesNotExist:
                poblar_gestion_vacacion(f)
    except Exception:
        pass  # No interrumpir migrate si la DB aún no está lista
