import logging
import sys
import threading
from datetime import date

from django.conf import settings
from django.apps import AppConfig
from django.core.management import call_command

logger = logging.getLogger(__name__)


class VacationsConfig(AppConfig):
    name = 'vacations'

    def ready(self):
        from django.db.models.signals import post_migrate
        from django.core.signals import request_started
        post_migrate.connect(_auto_poblar_vacaciones, sender=self)
        # En el primer request (no en migrate) también se ejecuta,
        # así funciona al clonar y arrancar sin necesidad de migrate adicional
        request_started.connect(_auto_poblar_vacaciones_primer_request)
        # request_started.connect(_corregir_dias_perdidos_primer_request)
        # La acreditación diaria automática queda desactivada en DEBUG porque
        # en el servidor de desarrollo se dispara al primer request de cada
        # arranque y puede volver a tocar saldos cuando solo se está probando.
        if not settings.DEBUG:
            request_started.connect(_poblar_vacaciones_diario)


def _auto_poblar_vacaciones(sender, **kwargs):
    """
    Se ejecuta automáticamente después de 'manage.py migrate' y en el primer
    request tras un deploy/reinicio.
    - Si el funcionario no tiene gestiones: las crea (poblar_gestion_vacacion
    ya aplica el tope de gestiones activas y evictúa a dias_perdidos si
    corresponde).

    IMPORTANTE: ya NO se "corrige" (reset + repoblar) a funcionarios que ya
    tienen un GestionVacacion existente, aunque sus años no coincidan con los
    4 años candidatos que calcula calcular_gestioneS_pendientes. Con el tope
    de 2 gestiones activas, un funcionario correctamente al día NUNCA va a
    tener los 4 años candidatos completos -solo los 2 activos-, así que esa
    comparación siempre daría "incorrecto" y este signal repoblaría (y
    evictuaría a dias_perdidos) en cada reinicio del servidor, duplicando el
    descuento cada vez. La acreditación de gestiones nuevas para funcionarios
    ya existentes debe hacerse explícitamente (RRHH: botón "Poblar ahora",
    AcreditarGestionView, o manage.py poblar_vacaciones), nunca de forma
    silenciosa en cada arranque.
    """
    try:
        from employees.models import Funcionario
        from vacations.models import GestionVacacion
        from vacations.utils import poblar_gestion_vacacion, calcular_gestioneS_pendientes

        for f in Funcionario.objects.filter(estado='ACTIVO'):
            esperadas = calcular_gestioneS_pendientes(f.fecha_ingreso)
            if not esperadas:
                continue  # Sin antigüedad suficiente

            if not GestionVacacion.objects.filter(cod_funcionario=f).exists():
                poblar_gestion_vacacion(f)

        # Crear usuario Django si no existe (para poder iniciar sesión)
        from django.contrib.auth.models import User
        for f in Funcionario.objects.select_related('ci').filter(estado='ACTIVO'):
            ci = f.ci.ci
            if not User.objects.filter(username=ci).exists():
                User.objects.create_user(username=ci, password=f.contrasena_hash or '12345678')

    except Exception:
        pass  # No interrumpir migrate/startup si la DB aún no está lista


_primer_request_ejecutado = False

def _auto_poblar_vacaciones_primer_request(sender, **kwargs):
    """Corre _auto_poblar_vacaciones una sola vez en el primer request HTTP."""
    global _primer_request_ejecutado
    if _primer_request_ejecutado:
        return
    _primer_request_ejecutado = True
    _auto_poblar_vacaciones(sender=sender)


_correccion_dias_perdidos_ejecutada = False


def _corregir_dias_perdidos_primer_request(sender, **kwargs):
    """Ejecuta la corrección de dias_perdidos una sola vez por proceso."""
    if 'test' in sys.argv:
        return

    global _correccion_dias_perdidos_ejecutada
    if _correccion_dias_perdidos_ejecutada:
        return
    _correccion_dias_perdidos_ejecutada = True

    def _tarea():
        try:
            call_command('corregir_dias_perdidos', verbosity=0)
        except Exception:
            logger.exception('Fallo la correccion automatica de dias perdidos')

    threading.Thread(target=_tarea, daemon=True).start()


_ultima_fecha_poblado_diario = None


def _poblar_vacaciones_diario(sender, **kwargs):
    """
    Acredita automáticamente las gestiones de vacación de todos los funcionarios
    activos cuyo aniversario ya se cumplió, una vez por día calendario
    (enganchado al primer request que llega ese día). Reemplaza al botón manual
    "Poblar ahora" de la notificación de dashboard, que fue desactivada.

    Idempotente: poblar_gestion_vacacion() solo rellena slots vacíos y aplica
    la evicción a dias_perdidos si corresponde, nunca sobreescribe una gestión
    ya acreditada, así que no importa si corre más de una vez el mismo día
    (ej. despliegues con varios workers).
    """
    if 'test' in sys.argv:
        return  # Evita hilos de fondo compitiendo con la transacción de cada test

    global _ultima_fecha_poblado_diario
    hoy = date.today()
    if _ultima_fecha_poblado_diario == hoy:
        return
    _ultima_fecha_poblado_diario = hoy

    def _tarea():
        from django.db import close_old_connections
        try:
            from employees.models import Funcionario
            from vacations.utils import poblar_gestion_vacacion, calcular_gestioneS_pendientes

            for f in Funcionario.objects.filter(estado='ACTIVO'):
                if calcular_gestioneS_pendientes(f.fecha_ingreso):
                    poblar_gestion_vacacion(f)
        except Exception:
            logger.exception('Fallo el poblado diario automático de vacaciones')
        finally:
            close_old_connections()

    threading.Thread(target=_tarea, daemon=True).start()
