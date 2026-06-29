from datetime import date

from django.db import transaction


def reasignar_aprobador(old_aprobador, new_aprobador, hoy=None):
    """
    Transfiere todos los registros activos de JerarquiaAprobacion del aprobador
    saliente al entrante. Se llama cuando un nuevo gerente es designado para
    reemplazar al anterior del mismo tipo.
    """
    from vacations.models import JerarquiaAprobacion

    if hoy is None:
        hoy = date.today()

    registros = list(
        JerarquiaAprobacion.objects.filter(cod_aprobador=old_aprobador, activo=True)
    )
    for reg in registros:
        reg.activo = False
        reg.fecha_fin = hoy
        reg.save(update_fields=['activo', 'fecha_fin'])
        JerarquiaAprobacion.objects.create(
            cod_funcionario=reg.cod_funcionario,
            cod_aprobador=new_aprobador,
            nivel_aprobacion=reg.nivel_aprobacion,
            activo=True,
        )
    return len(registros)


def redirigir_jerarquia_por_baja_jefe(jefe, hoy=None):
    """
    Cuando un Jefe de Área es dado de baja, elimina su nivel de aprobación (nivel 1)
    de la cadena de todos sus subordinados y renumera los niveles restantes:
      nivel 2 (Gerente Adm./Salud) → nivel 1
      nivel 3 (Gerente General)    → nivel 2

    Esto permite que las solicitudes pendientes en estado PENDIENTE_JEFE
    sean atendidas directamente por el Gerente Administrativo o de Salud.
    """
    from vacations.models import JerarquiaAprobacion

    if hoy is None:
        hoy = date.today()

    nivel1_por_subordinado = list(
        JerarquiaAprobacion.objects.filter(
            cod_aprobador=jefe, nivel_aprobacion=1, activo=True
        ).select_related('cod_funcionario')
    )

    for nivel1_reg in nivel1_por_subordinado:
        subordinado = nivel1_reg.cod_funcionario

        todos = list(
            JerarquiaAprobacion.objects.filter(
                cod_funcionario=subordinado, activo=True
            ).order_by('nivel_aprobacion')
        )

        with transaction.atomic():
            for j in todos:
                j.activo = False
                j.fecha_fin = hoy
                j.save(update_fields=['activo', 'fecha_fin'])

            nuevo_nivel = 1
            for j in todos:
                if j.nivel_aprobacion == 1:
                    continue
                JerarquiaAprobacion.objects.create(
                    cod_funcionario=subordinado,
                    cod_aprobador=j.cod_aprobador,
                    nivel_aprobacion=nuevo_nivel,
                    activo=True,
                )
                nuevo_nivel += 1
