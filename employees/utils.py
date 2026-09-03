import unicodedata
from datetime import date

from django.db import transaction

# Masculino: mes tal cual (01-12). Femenino: mes + 50 → enero=51 ... diciembre=62.
_OFFSET_MES_FEMENINO = 50


def _inicial(texto: str) -> str:
    """Primera letra del texto, mayúscula, sin diacríticos."""
    texto = (texto or '').strip()
    if not texto:
        return ''
    base = ''.join(
        c for c in unicodedata.normalize('NFD', texto[0])
        if unicodedata.category(c) != 'Mn'
    )
    return base.upper()


def generar_matricula_seguro(persona, excluir_cod: str = None) -> str:
    """
    Genera la matrícula del seguro social a partir de los datos de la Persona
    (9 caracteres, 10 si la persona tiene dos nombres):

      [2 últimos dígitos año nacimiento]
      [2 dígitos mes + sexo — varones 01-12, mujeres 51-62]
      [2 dígitos día]
      [inicial ap_paterno][inicial ap_materno]
      [inicial del nombre; si tiene dos nombres, las iniciales de ambos]

    Ej.: Fedra Montero Suárez → ...MSF   |   Fátima Carmela Vaca Hurtado → ...VHFC

    Si la matrícula ya existe agrega sufijo numérico (2, 3, ...) hasta encontrar una libre.
    """
    from employees.models import Funcionario

    fn   = persona.fecha_nacimiento
    anio = str(fn.year)[-2:]
    dia  = str(fn.day).zfill(2)

    if persona.sexo == 'Femenino':
        mes = str(fn.month + _OFFSET_MES_FEMENINO).zfill(2)
    else:
        mes = str(fn.month).zfill(2)

    ini_pat = _inicial(persona.ap_paterno)
    ini_mat = _inicial(persona.ap_materno or '')

    palabras = (persona.nombre or '').split()
    ini_nom1 = _inicial(palabras[0]) if palabras else ''
    ini_nom2 = _inicial(palabras[1]) if len(palabras) > 1 else ''

    base = f"{anio}{mes}{dia}{ini_pat}{ini_mat}{ini_nom1}{ini_nom2}"

    # Al regenerar la matrícula de un funcionario existente no debe contar
    # como colisión la suya propia, o se le agregaría un sufijo en cada edición.
    ocupadas = Funcionario.objects.all()
    if excluir_cod:
        ocupadas = ocupadas.exclude(cod_funcionario=excluir_cod)

    if not ocupadas.filter(matricula_seguro=base).exists():
        return base

    sufijo = 2
    while ocupadas.filter(matricula_seguro=f"{base}{sufijo}").exists():
        sufijo += 1
    return f"{base}{sufijo}"


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
