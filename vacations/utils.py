from datetime import date
from decimal import Decimal


def calcular_anios_antiguedad(fecha_ingreso: date, referencia: date = None) -> int:
    """Años completos de servicio entre fecha_ingreso y referencia (o hoy)."""
    if referencia is None:
        referencia = date.today()
    anios = referencia.year - fecha_ingreso.year
    if (referencia.month, referencia.day) < (fecha_ingreso.month, fecha_ingreso.day):
        anios -= 1
    return max(anios, 0)


def dias_por_antiguedad(anios: int) -> Decimal:
    """
    Días hábiles de vacación anual según Ley General del Trabajo de Bolivia.

    1 a 5 años   → 15 días hábiles
    5 a 10 años  → 20 días hábiles
    10+ años     → 30 días hábiles
    < 1 año      →  0 días (no corresponde)
    """
    if anios < 1:
        return Decimal('0')
    if anios < 5:
        return Decimal('15')
    if anios < 10:
        return Decimal('20')
    return Decimal('30')


def calcular_gestioneS_pendientes(fecha_ingreso: date, hoy: date = None):
    """
    Devuelve hasta 4 tuplas (slot, anio, dias) con las 4 gestiones más
    recientes del funcionario, de más antigua a más reciente.

    Regla de gestión más reciente válida:
      - Si hoy >= aniversario del año actual  → gestión reciente = año actual
      - Si hoy <  aniversario del año actual  → gestión reciente = año actual - 1

    slot 4 = gestión más antigua (se consume primero).
    slot 1 = gestión más reciente.
    """
    if hoy is None:
        hoy = date.today()

    # Aniversario en el año actual (maneja bisiesto)
    try:
        aniversario_hoy = fecha_ingreso.replace(year=hoy.year)
    except ValueError:
        aniversario_hoy = date(hoy.year, 3, 1)

    gestion_reciente = hoy.year if hoy >= aniversario_hoy else hoy.year - 1

    # 4 gestiones de más reciente a más antigua, filtrando las que no tienen 1 año completo
    gestioneS = []  # [(anio, dias)] newest first
    for year in range(gestion_reciente, gestion_reciente - 4, -1):
        anios = calcular_anios_antiguedad(fecha_ingreso, date(year, 12, 31))
        if anios >= 1:
            gestioneS.append((year, dias_por_antiguedad(anios)))

    # Asignar slots: oldest → slot 4, newest → slot 1
    result = []
    for idx, (year, dias) in enumerate(reversed(gestioneS)):  # oldest first
        slot = 4 - idx
        result.append((slot, year, dias))
    return result


def poblar_gestion_vacacion(funcionario):
    """
    Crea o completa el GestionVacacion del funcionario con las gestiones que
    le corresponden según la Ley General del Trabajo. Solo rellena slots vacíos.

    Retorna dict con estadísticas: acreditadas, ya_existentes, sin_elegibilidad.
    """
    from vacations.models import GestionVacacion

    hoy = date.today()
    gestioneS = calcular_gestioneS_pendientes(funcionario.fecha_ingreso, hoy)

    if not gestioneS:
        return {'acreditadas': 0, 'ya_existentes': 0, 'sin_elegibilidad': True}

    try:
        gv = GestionVacacion.objects.get(cod_funcionario=funcionario)
        es_nueva = False
    except GestionVacacion.DoesNotExist:
        gv = GestionVacacion(cod_funcionario=funcionario)
        es_nueva = True

    campos_a_guardar = []
    acreditadas = 0
    ya_existentes = 0

    # Verificar años ya acreditados para no duplicar
    anios_existentes = {
        getattr(gv, f'anio_gestion{i}')
        for i in range(1, 5)
        if getattr(gv, f'anio_gestion{i}') is not None
    }

    for slot, anio, dias in gestioneS:
        if anio in anios_existentes:
            ya_existentes += 1
            continue
        if getattr(gv, f'anio_gestion{slot}') is not None:
            # Slot ocupado por otro año → buscar el próximo slot libre
            for alt in range(4, 0, -1):
                if getattr(gv, f'anio_gestion{alt}') is None:
                    slot = alt
                    break
            else:
                ya_existentes += 1
                continue

        setattr(gv, f'anio_gestion{slot}', anio)
        setattr(gv, f'dias_gestion{slot}', dias)
        campos_a_guardar += [f'anio_gestion{slot}', f'dias_gestion{slot}']
        anios_existentes.add(anio)
        acreditadas += 1

    if es_nueva:
        gv.save()
    elif campos_a_guardar:
        gv.save(update_fields=campos_a_guardar)

    return {'acreditadas': acreditadas, 'ya_existentes': ya_existentes, 'sin_elegibilidad': False}
