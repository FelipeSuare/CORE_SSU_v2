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


LIMITE_GESTIONES_ACTIVAS = 2

# Rechazo cerca del vencimiento: si la solicitud se hizo dentro de estos días
# antes de la fecha límite de la gestión en riesgo, esa gestión queda
# protegida hasta fecha límite + estos meses.
DIAS_ANTICIPO_RECHAZO_PROTEGIDO = 30
MESES_EXTENSION_RECHAZO = 6


def sumar_meses(fecha: date, meses: int) -> date:
    """fecha + N meses, ajustando el día al último válido del mes destino."""
    import calendar
    total = fecha.month - 1 + meses
    anio, mes = fecha.year + total // 12, total % 12 + 1
    return date(anio, mes, min(fecha.day, calendar.monthrange(anio, mes)[1]))


def aniversario(fecha_ingreso: date, anio: int) -> date:
    """Aniversario de ingreso en `anio` (29/02 → 01/03 en año no bisiesto)."""
    try:
        return fecha_ingreso.replace(year=anio)
    except ValueError:
        return date(anio, 3, 1)


def anios_protegidos(cod_funcionario, hoy: date = None) -> set:
    """Años de gestión del funcionario cubiertos por un acuerdo VIGENTE no vencido."""
    from vacations.models import AcuerdoVacacionFuncionario

    if not cod_funcionario:
        return set()
    return set(AcuerdoVacacionFuncionario.objects.filter(
        cod_funcionario=cod_funcionario,
        id_acuerdo__estado='VIGENTE',
        id_acuerdo__fecha_hasta__gte=hoy or date.today(),
    ).values_list('anio_gestion', flat=True))


# Clave del advisory lock de numeración RA (arbitraria, fija para el proyecto).
_LOCK_NRO_ACUERDO = 7101


def siguiente_correlativo(anio: int) -> int:
    """
    Próximo correlativo RA-XX/`anio`. Debe llamarse dentro de
    transaction.atomic(): el advisory lock serializa creaciones simultáneas
    hasta el commit, y UNIQUE(anio_nro, correlativo) es la red de seguridad.
    """
    from django.db import connection
    from django.db.models import Max
    from vacations.models import AcuerdoVacacion

    with connection.cursor() as cur:
        cur.execute('SELECT pg_advisory_xact_lock(%s, %s)', [_LOCK_NRO_ACUERDO, anio])
    ultimo = AcuerdoVacacion.objects.filter(anio_nro=anio).aggregate(m=Max('correlativo'))['m']
    return (ultimo or 0) + 1


def gestiones_ocupadas(gv, excluir: set = frozenset()) -> list:
    """[(slot, anio, dias)] de slots con año, ordenado por año ascendente."""
    return sorted(
        (
            (i, getattr(gv, f'anio_gestion{i}'), getattr(gv, f'dias_gestion{i}'))
            for i in range(1, 5)
            if getattr(gv, f'anio_gestion{i}') is not None
            and getattr(gv, f'anio_gestion{i}') not in excluir
        ),
        key=lambda t: t[1],
    )


def gestion_en_riesgo(gv, fecha_ingreso: date, protegidos: set = frozenset()):
    """
    (slot, anio, dias, fecha_limite) de la gestión no protegida que se
    perdería con la próxima acreditación, o None si aún hay espacio en el tope.
    fecha_limite = aniversario en que se acredita la gestión siguiente a la
    más reciente activa.
    """
    activas = gestiones_ocupadas(gv, protegidos)
    if len(activas) < LIMITE_GESTIONES_ACTIVAS:
        return None
    slot, anio, dias = activas[0]
    return slot, anio, dias, aniversario(fecha_ingreso, activas[-1][1] + 1)


def devolver_dias(gv, dias: Decimal) -> None:
    """
    Repone días (rechazo/anulación) en la gestión más antigua por año, que es
    de donde CrearSolicitudView los descuenta primero. Solo en memoria.
    """
    ocupadas = gestiones_ocupadas(gv)
    # Sin gestiones con año (caso anómalo): slot 4, comportamiento previo.
    slot = ocupadas[0][0] if ocupadas else 4
    setattr(gv, f'dias_gestion{slot}', getattr(gv, f'dias_gestion{slot}') + dias)


def aplicar_limite_gestiones_activas(gv, limite: int = LIMITE_GESTIONES_ACTIVAS, protegidos: set = None) -> list:
    """
    Recorta las gestiones activas (anio_gestion1..4) al límite dado, moviendo
    el exceso -empezando por la gestión con año más antiguo- a gv.dias_perdidos.

    Ordena por año real (no por número de slot): AcreditarGestionView asigna
    el primer slot vacío que encuentra, así que el número de slot no siempre
    refleja antigüedad real.

    Opera en memoria sobre `gv`; no llama a gv.save() (responsabilidad del
    caller, que decide qué campos persistir).

    Idempotente: si ya hay <= limite gestiones activas, no hace nada y
    retorna [].

    Las gestiones protegidas por un AcuerdoVacacion vigente no cuentan para el
    tope ni se evictan; al vencer el acuerdo, la próxima pasada (poblado
    diario) las evicta normalmente. `protegidos=None` los consulta en BD.

    Retorna la lista de evicciones aplicadas: [{'slot', 'anio', 'dias'}, ...]
    """
    if protegidos is None:
        protegidos = anios_protegidos(gv.cod_funcionario_id)
    ocupados = gestiones_ocupadas(gv, protegidos)  # año ascendente
    exceso = len(ocupados) - limite
    if exceso <= 0:
        return []

    evictados = []
    for slot, anio, dias in ocupados[:exceso]:
        gv.dias_perdidos = (gv.dias_perdidos or Decimal('0')) + (dias or Decimal('0'))
        setattr(gv, f'anio_gestion{slot}', None)
        setattr(gv, f'dias_gestion{slot}', Decimal('0'))
        evictados.append({'slot': slot, 'anio': anio, 'dias': dias})
    return evictados


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

    protegidos = anios_protegidos(funcionario.cod_funcionario, hoy)
    evictadas = []

    # Años anteriores al más reciente ya registrado fueron consumidos o
    # evictados: re-acreditarlos los volvería a evictar y sumaría otra vez a
    # dias_perdidos en cada pasada del poblado diario.
    ultimo_existente = max(anios_existentes, default=None)

    for slot, anio, dias in gestioneS:
        if anio in anios_existentes or (ultimo_existente is not None and anio < ultimo_existente):
            ya_existentes += 1
            continue
        if getattr(gv, f'anio_gestion{slot}') is not None:
            # Slot ocupado por otro año → buscar el próximo slot libre
            libre = next((alt for alt in range(4, 0, -1) if getattr(gv, f'anio_gestion{alt}') is None), None)
            if libre is None:
                # 4 slots llenos (gestiones protegidas o datos legado): se libera
                # espacio evictando la no protegida más antigua, como AcreditarGestionView.
                evictadas += aplicar_limite_gestiones_activas(gv, LIMITE_GESTIONES_ACTIVAS - 1, protegidos)
                libre = next((alt for alt in range(4, 0, -1) if getattr(gv, f'anio_gestion{alt}') is None), None)
            if libre is None:
                ya_existentes += 1
                continue
            slot = libre

        setattr(gv, f'anio_gestion{slot}', anio)
        setattr(gv, f'dias_gestion{slot}', dias)
        campos_a_guardar += [f'anio_gestion{slot}', f'dias_gestion{slot}']
        anios_existentes.add(anio)
        acreditadas += 1

    evictadas += aplicar_limite_gestiones_activas(gv, protegidos=protegidos)
    if evictadas:
        campos_a_guardar.append('dias_perdidos')
        for ev in evictadas:
            campos_a_guardar += [f"anio_gestion{ev['slot']}", f"dias_gestion{ev['slot']}"]

    if es_nueva:
        gv.save()
    elif campos_a_guardar:
        gv.save(update_fields=campos_a_guardar)

    return {
        'acreditadas': acreditadas,
        'ya_existentes': ya_existentes,
        'sin_elegibilidad': False,
        'evictadas': evictadas,
    }


def resincronizar_gestiones(funcionario, fecha_ingreso_anterior):
    """
    Reajusta las gestiones cuando se corrige la fecha de ingreso del funcionario.

    Los años de gestión y los días por antigüedad se recalculan con la fecha
    nueva; los días ya consumidos en cada año se conservan (se descuentan del
    saldo nuevo) para que corregir la fecha no devuelva vacaciones ya tomadas.

    Retorna True si hubo cambio de fecha y se resincronizó.
    """
    from vacations.models import GestionVacacion

    if not fecha_ingreso_anterior or fecha_ingreso_anterior == funcionario.fecha_ingreso:
        return False

    gv = GestionVacacion.objects.filter(cod_funcionario=funcionario).first()
    if gv is None:
        poblar_gestion_vacacion(funcionario)
        return True

    # Días ya consumidos por año, medidos contra la asignación anterior.
    consumidos = {}
    for i in range(1, 5):
        anio = getattr(gv, f'anio_gestion{i}')
        if anio is None:
            continue
        anios_ant = calcular_anios_antiguedad(fecha_ingreso_anterior, date(anio, 12, 31))
        esperado  = dias_por_antiguedad(anios_ant) if anios_ant >= 1 else Decimal('0')
        consumidos[anio] = max(Decimal('0'), esperado - getattr(gv, f'dias_gestion{i}'))

    for i in range(1, 5):
        setattr(gv, f'anio_gestion{i}', None)
        setattr(gv, f'dias_gestion{i}', Decimal('0'))

    for slot, anio, dias in calcular_gestioneS_pendientes(funcionario.fecha_ingreso):
        setattr(gv, f'anio_gestion{slot}', anio)
        setattr(gv, f'dias_gestion{slot}', max(Decimal('0'), dias - consumidos.get(anio, Decimal('0'))))

    # Los períodos cambiaron: la pérdida por exceso de gestiones se recalcula.
    gv.dias_perdidos = Decimal('0')
    aplicar_limite_gestiones_activas(gv)
    gv.save()
    return True
