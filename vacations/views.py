import json
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from io import BytesIO

from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_POST

from core.models import Feriado, UnidadOrganizacional
from employees.models import Funcionario, HistorialCargo
from accounts.models import FuncionarioRol
from vacations.models import (
    AnulacionAjuste, AprobacionSolicitud, GestionVacacion,
    JerarquiaAprobacion, SolicitudVacacion,
)
from vacations.utils import calcular_anios_antiguedad, dias_por_antiguedad, poblar_gestion_vacacion

_NIVEL_LABELS = {
    'PERSONAL DE AREA':      {1: 'Jefe de Área', 2: 'Gerente Adm./Salud', 3: 'Gerente General'},
    'JEFE AREA':             {1: 'Gerente Adm./Salud', 2: 'Gerente General'},
    'DEPENDENCIA DIRECTA':   {1: 'Gerente General'},
    'GERENTE ADMINISTRATIVO':{1: 'Gerente General'},
    'GERENTE SALUD':         {1: 'Gerente General'},
    'GERENTE GENERAL':       {},
}

_ESTADOS_PENDIENTE = ('PENDIENTE_JEFE', 'PENDIENTE_GERENTE_AREA', 'PENDIENTE_GERENTE_GENERAL')

_NIVEL_COLS = {
    'PERSONAL DE AREA': [
        {'db_nivel': 1, 'header': 'Nivel 1', 'subtitle': 'Jefe de Área'},
        {'db_nivel': 2, 'header': 'Nivel 2', 'subtitle': 'Gte. Adm./Salud'},
        {'db_nivel': 3, 'header': 'Nivel 3', 'subtitle': 'Gerente General'},
    ],
    'JEFE AREA': [
        {'db_nivel': 1, 'header': 'Nivel 2', 'subtitle': 'Gte. Adm./Salud'},
        {'db_nivel': 2, 'header': 'Nivel 3', 'subtitle': 'Gerente General'},
    ],
    'DEPENDENCIA DIRECTA':   [{'db_nivel': 1, 'header': 'Nivel 3', 'subtitle': 'Gerente General'}],
    'GERENTE ADMINISTRATIVO':[{'db_nivel': 1, 'header': 'Nivel 3', 'subtitle': 'Gerente General'}],
    'GERENTE SALUD':         [{'db_nivel': 1, 'header': 'Nivel 3', 'subtitle': 'Gerente General'}],
    'GERENTE GENERAL':       [],
}


# ──────────────────────────────────────────────────────────────
#  Helpers internos
# ──────────────────────────────────────────────────────────────

def _get_funcionario(request):
    """Obtiene el Funcionario activo cuyo CI coincide con el username de sesión."""
    ci = request.user.username
    return Funcionario.objects.select_related('ci', 'id_unidad').get(
        ci__ci=ci, estado='ACTIVO'
    )


def _preview_codigo(funcionario):
    n = SolicitudVacacion.objects.filter(cod_funcionario=funcionario).count() + 1
    return f"G{n:03d}"


def _estado_display(estado_db):
    if estado_db in _ESTADOS_PENDIENTE:
        return 'Pendiente'
    if estado_db == 'APROBADA':
        return 'Aprobada'
    if estado_db in ('RECHAZADA', 'RECHAZADO'):
        return 'Rechazada'
    return estado_db


def _saldos_para_js(gv):
    gestiones = []
    for i in range(1, 5):
        anio = getattr(gv, f'anio_gestion{i}')
        dias = float(getattr(gv, f'dias_gestion{i}'))
        if anio is not None or dias > 0:
            gestiones.append({
                'numero': i,
                'anio': anio,
                'dias': dias,
                'label': f'GESTIÓN {anio}' if anio else f'GESTIÓN {i}',
            })
    return {
        'gestiones': gestiones,
        'dias_negados': float(gv.dias_negados),
        'dias_adeudados': float(gv.dias_adeudados or 0),
    }


def _calcular_retorno(fecha_salida, dias_solicitados, fecha_nacimiento, feriados_set):
    """
    Avanza desde fecha_salida contando días hábiles hasta completar dias_solicitados.
    Cumpleaños aporta 0.5 días hábiles (medio asueto).
    Devuelve fecha_retorno (primer día de vuelta) y contadores.
    """
    dias_habiles = Decimal('0')
    dias_fines_semana = 0
    dias_feriados_count = 0
    dias_cumple = 0
    target = Decimal(str(dias_solicitados))
    fecha_actual = fecha_salida

    while dias_habiles < target:
        dow = fecha_actual.weekday()  # 0=lun … 6=dom

        if dow >= 5:
            dias_fines_semana += 1
            fecha_actual += timedelta(days=1)
            continue

        if fecha_actual in feriados_set:
            dias_feriados_count += 1
            fecha_actual += timedelta(days=1)
            continue

        if (fecha_nacimiento
                and fecha_actual.month == fecha_nacimiento.month
                and fecha_actual.day == fecha_nacimiento.day):
            dias_cumple += 1
            dias_habiles += Decimal('0.5')
            fecha_actual += timedelta(days=1)
            continue

        dias_habiles += Decimal('1')
        fecha_actual += timedelta(days=1)

    return {
        'fecha_retorno': fecha_actual,
        'dias_fines_semana': dias_fines_semana,
        'dias_feriados': dias_feriados_count,
        'dias_cumpleanos': dias_cumple,
    }


# ──────────────────────────────────────────────────────────────
#  Páginas HTML
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def vacaciones_view(request):
    return render(request, 'vacations/Vacaciones.html')


@login_required(login_url='login_home')
def historial_solicitudes_view(request):
    return render(request, 'vacations/Historial_Solicitudes.html')


# ──────────────────────────────────────────────────────────────
#  API: datos del formulario (GET)
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def datos_formulario(request):
    try:
        f = _get_funcionario(request)
    except Funcionario.DoesNotExist:
        return JsonResponse({'error': 'Funcionario no encontrado o inactivo.'}, status=404)

    p = f.ci
    cargo_act = HistorialCargo.objects.filter(cod_funcionario=f, es_actual=True).first()

    try:
        gv = GestionVacacion.objects.get(cod_funcionario=f)
        saldos = _saldos_para_js(gv)
    except GestionVacacion.DoesNotExist:
        saldos = {'gestiones': [], 'dias_negados': 0.0, 'dias_adeudados': 0.0}

    jerarquia = [
        {
            'nivel': j.nivel_aprobacion,
            'cod': j.cod_aprobador.cod_funcionario,
            'nombre': (
                f"{j.cod_aprobador.ci.nombre} "
                f"{j.cod_aprobador.ci.ap_paterno} "
                f"{j.cod_aprobador.ci.ap_materno or ''}"
            ).strip(),
        }
        for j in JerarquiaAprobacion.objects.filter(
            cod_funcionario=f, activo=True
        ).select_related('cod_aprobador__ci').order_by('nivel_aprobacion')
    ]

    hoy = date.today()
    fi = f.fecha_ingreso
    anios = calcular_anios_antiguedad(fi)
    puede_solicitar = anios >= 1 and saldos['dias_adeudados'] > 0
    dias_correspondientes = float(dias_por_antiguedad(anios))

    # Cuántas gestiones tienen saldo > 0
    gestiones_con_saldo = sum(
        1 for g in saldos['gestiones'] if g['dias'] > 0
    )

    # Roles activos del funcionario (para el profile-switcher)
    roles_activos = list(FuncionarioRol.objects.filter(
        cod_funcionario=f, activo=True
    ).values_list('id_roles__tipo_rol', flat=True))

    # Siempre incluir 'Funcionario' como rol base
    if 'Funcionario' not in roles_activos:
        roles_activos.insert(0, 'Funcionario')

    return JsonResponse({
        'cod_funcionario': f.cod_funcionario,
        'nombre_completo': f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip(),
        'ci': p.ci,
        'tipo_contrato': cargo_act.tipo_contrato if cargo_act else '',
        'fecha_ingreso': fi.strftime('%Y-%m-%d'),
        'fecha_nacimiento': p.fecha_nacimiento.strftime('%Y-%m-%d') if p.fecha_nacimiento else '',
        'fecha_solicitud': hoy.strftime('%Y-%m-%d'),
        'siguiente_codigo': _preview_codigo(f),
        'saldos': saldos,
        'jerarquia': jerarquia,
        'puede_solicitar': puede_solicitar,
        'tipo_funcionario': f.tipo_funcionario,
        'gestiones_con_saldo': gestiones_con_saldo,
        'roles': roles_activos,
        'anios_antiguedad': anios,
        'dias_correspondientes': dias_correspondientes,
    })


# ──────────────────────────────────────────────────────────────
#  API: calcular fecha de retorno (POST)
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
@require_POST
def calcular_retorno_api(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Solicitud inválida.'}, status=400)

    fecha_salida_str = data.get('fecha_salida', '').strip()
    dias_str = str(data.get('dias_solicitados', '')).strip()
    cod_funcionario = data.get('cod_funcionario', '').strip()

    if not fecha_salida_str or not dias_str:
        return JsonResponse({'error': 'Datos incompletos.'}, status=400)

    try:
        fecha_salida = date.fromisoformat(fecha_salida_str)
        dias = Decimal(dias_str)
        if dias <= 0:
            raise ValueError
    except (ValueError, InvalidOperation):
        return JsonResponse({'error': 'Valores de fecha o días inválidos.'}, status=400)

    fecha_nacimiento = None
    if cod_funcionario:
        try:
            fobj = Funcionario.objects.select_related('ci').get(
                cod_funcionario=cod_funcionario
            )
            fecha_nacimiento = fobj.ci.fecha_nacimiento
        except Funcionario.DoesNotExist:
            pass

    feriados_set = set(Feriado.objects.values_list('fecha', flat=True))
    result = _calcular_retorno(fecha_salida, dias, fecha_nacimiento, feriados_set)

    fecha_retorno = result['fecha_retorno']
    fecha_conclusion = fecha_retorno - timedelta(days=1)

    return JsonResponse({
        'fecha_retorno': fecha_retorno.strftime('%Y-%m-%d'),
        'fecha_conclusion': fecha_conclusion.strftime('%Y-%m-%d'),
        'dias_fines_semana': result['dias_fines_semana'],
        'dias_feriados': result['dias_feriados'],
        'dias_cumpleanos': result['dias_cumpleanos'],
        'dias_no_habiles': result['dias_fines_semana'] + result['dias_feriados'],
    })


# ──────────────────────────────────────────────────────────────
#  API: crear solicitud (POST)
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
@require_POST
def crear_solicitud(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Solicitud inválida.'}, status=400)

    fecha_salida_str  = data.get('fecha_salida', '').strip()
    fecha_retorno_str = data.get('fecha_retorno', '').strip()
    dias_str          = str(data.get('dias_solicitados', '')).strip()
    motivo            = data.get('motivo_vacacion', '').strip()

    if not all([fecha_salida_str, fecha_retorno_str, dias_str, motivo]):
        return JsonResponse({'error': 'Todos los campos son requeridos.'}, status=400)

    if len(motivo) < 10:
        return JsonResponse(
            {'error': 'El motivo debe tener al menos 10 caracteres.'}, status=400
        )

    try:
        fecha_salida  = date.fromisoformat(fecha_salida_str)
        fecha_retorno = date.fromisoformat(fecha_retorno_str)
        dias          = Decimal(dias_str)
        if dias <= 0:
            raise ValueError
    except (ValueError, InvalidOperation):
        return JsonResponse({'error': 'Valores de fecha o días inválidos.'}, status=400)

    try:
        f = _get_funcionario(request)
    except Funcionario.DoesNotExist:
        return JsonResponse({'error': 'Funcionario no encontrado o inactivo.'}, status=404)

    try:
        gv = GestionVacacion.objects.get(cod_funcionario=f)
    except GestionVacacion.DoesNotExist:
        return JsonResponse(
            {'error': 'No se encontró el registro de gestión de vacaciones.'}, status=400
        )

    saldo_total = gv.dias_adeudados or Decimal('0')
    if dias > saldo_total:
        return JsonResponse(
            {'error': f'Saldo insuficiente. Disponible: {float(saldo_total)} días.'}, status=400
        )

    if SolicitudVacacion.objects.filter(
        cod_funcionario=f, estado__in=_ESTADOS_PENDIENTE
    ).exists():
        return JsonResponse(
            {'error': 'Ya tiene una solicitud de vacación pendiente de aprobación.'}, status=400
        )

    try:
        with transaction.atomic():
            # Sin niveles de aprobación (ej. GERENTE_GENERAL) → aprobada automáticamente
            tiene_niveles = JerarquiaAprobacion.objects.filter(
                cod_funcionario=f, activo=True
            ).exists()
            estado_inicial = 'PENDIENTE_JEFE' if tiene_niveles else 'APROBADA'

            solicitud = SolicitudVacacion.objects.create(
                cod_funcionario=f,
                fecha_salida=fecha_salida,
                fecha_retorno=fecha_retorno,
                dias_solicitados=dias,
                motivo_vacacion=motivo,
                estado=estado_inicial,
            )
            # Descontar días desde la gestión más antigua (4 → 1)
            pendientes = dias
            for i in range(4, 0, -1):
                if pendientes <= 0:
                    break
                campo = f'dias_gestion{i}'
                disponible = getattr(gv, campo)
                a_descontar = min(disponible, pendientes)
                setattr(gv, campo, disponible - a_descontar)
                pendientes -= a_descontar

            gv.save(update_fields=[
                'dias_gestion1', 'dias_gestion2', 'dias_gestion3', 'dias_gestion4'
            ])

    except Exception as e:
        return JsonResponse({'error': f'Error al registrar la solicitud: {e}'}, status=500)

    return JsonResponse({
        'ok': True,
        'id_formulario': solicitud.id_formulario,
        'codigo': f"G{solicitud.id_formulario:03d}",
    }, status=201)


# ──────────────────────────────────────────────────────────────
#  API: historial de mis solicitudes (GET)
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def mis_solicitudes(request):
    from django.db.models import Sum

    try:
        f = _get_funcionario(request)
    except Funcionario.DoesNotExist:
        return JsonResponse({'error': 'Funcionario no encontrado.'}, status=404)

    # Corregir solicitudes antiguas de funcionarios sin niveles de aprobación
    # que quedaron atrapadas en estado PENDIENTE_* antes del fix de auto-aprobación.
    sin_niveles = not JerarquiaAprobacion.objects.filter(
        cod_funcionario=f, activo=True
    ).exists()
    if sin_niveles:
        SolicitudVacacion.objects.filter(
            cod_funcionario=f, estado__in=list(_ESTADOS_PENDIENTE)
        ).update(estado='APROBADA')

    solicitudes_qs = list(
        SolicitudVacacion.objects.filter(cod_funcionario=f)
        .order_by('-fecha_solicitud', '-fecha_creacion')
    )
    ids = [s.id_formulario for s in solicitudes_qs]

    aprs_por_sol = {}
    for ap in AprobacionSolicitud.objects.filter(
        id_formulario__in=ids
    ).select_related('cod_aprobador__ci').order_by('nivel'):
        aprs_por_sol.setdefault(ap.id_formulario_id, {})[ap.nivel] = ap

    # Días ya devueltos por ajustes parciales por solicitud
    ajustes_parciales = {
        row['id_formulario']: float(row['total'])
        for row in AnulacionAjuste.objects.filter(
            id_formulario__in=ids,
            tipo_anulacion='AJUSTE',
        ).values('id_formulario').annotate(total=Sum('dias_devolver'))
    }

    def dato_nivel(aprs, nivel):
        ap = aprs.get(nivel)
        if not ap:
            return None
        return {
            'nombre': f"{ap.cod_aprobador.ci.nombre} {ap.cod_aprobador.ci.ap_paterno}".strip(),
            'fecha': ap.fecha_decision.strftime('%Y-%m-%d'),
            'decision': ap.decision,
            'observacion': ap.observacion or '',
        }

    resultado = []
    for s in solicitudes_qs:
        aprs = aprs_por_sol.get(s.id_formulario, {})
        todas_obs = [ap.observacion for ap in aprs.values() if ap.observacion]
        dias_ajustados = ajustes_parciales.get(s.id_formulario, 0.0)
        resultado.append({
            'id': s.id_formulario,
            'codigo': f"G{s.id_formulario:03d}",
            'fecha_solicitud': s.fecha_solicitud.strftime('%Y-%m-%d'),
            'fecha_salida': s.fecha_salida.strftime('%Y-%m-%d'),
            'fecha_retorno': s.fecha_retorno.strftime('%Y-%m-%d'),
            'dias': float(s.dias_solicitados) - dias_ajustados,
            'motivo': s.motivo_vacacion or '',
            'estado': _estado_display(s.estado),
            'nivel1': dato_nivel(aprs, 1),
            'nivel2': dato_nivel(aprs, 2),
            'nivel3': dato_nivel(aprs, 3),
            'observaciones': todas_obs[-1] if todas_obs else None,
        })

    try:
        gv = GestionVacacion.objects.get(cod_funcionario=f)
        dias_adeudados = float(gv.dias_adeudados or 0)
    except GestionVacacion.DoesNotExist:
        dias_adeudados = 0.0

    dias_usados = sum(r['dias'] for r in resultado if r['estado'] == 'Aprobada')
    dias_pendientes = sum(r['dias'] for r in resultado if r['estado'] == 'Pendiente')

    return JsonResponse({
        'solicitudes': resultado,
        'resumen': {
            'total': len(resultado),
            'dias_usados': dias_usados,
            'dias_pendientes': dias_pendientes,
            'dias_adeudados': dias_adeudados,
        },
        'funcionario': {
            'nombre': f"{f.ci.nombre} {f.ci.ap_paterno} {f.ci.ap_materno or ''}".strip(),
            'ci': f.ci.ci,
        },
        'tipo_funcionario': f.tipo_funcionario,
        'nivel_cols': _NIVEL_COLS.get(f.tipo_funcionario, _NIVEL_COLS['PERSONAL DE AREA']),
    })


# ──────────────────────────────────────────────────────────────
#  API: seguimiento de la solicitud más reciente (GET)
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def seguimiento_solicitud(request):
    try:
        f = _get_funcionario(request)
    except Funcionario.DoesNotExist:
        return JsonResponse({'error': 'Funcionario no encontrado.'}, status=404)

    solicitud = (
        SolicitudVacacion.objects.filter(cod_funcionario=f)
        .order_by('-fecha_creacion')
        .first()
    )
    if not solicitud:
        return JsonResponse({'tiene_solicitud': False})

    aprobaciones = {
        ap.nivel: ap
        for ap in AprobacionSolicitud.objects.filter(
            id_formulario=solicitud
        ).select_related('cod_aprobador__ci')
    }

    jerarquia = list(
        JerarquiaAprobacion.objects.filter(
            cod_funcionario=f, activo=True
        ).select_related('cod_aprobador__ci').order_by('nivel_aprobacion')
    )

    labels = _NIVEL_LABELS.get(f.tipo_funcionario, {})

    timeline = [{
        'nivel': 'Funcionario',
        'responsable': f"{f.ci.nombre} {f.ci.ap_paterno}".strip(),
        'estado': 'sent',
        'fecha': solicitud.fecha_solicitud.strftime('%Y-%m-%d'),
        'comentarios': solicitud.motivo_vacacion or 'Solicitud enviada a revisión',
    }]

    # Sin niveles de aprobación → entrada automática en el timeline
    if not jerarquia:
        timeline.append({
            'nivel':       'Aprobación automática',
            'responsable': 'Sistema',
            'estado':      'approved',
            'fecha':       solicitud.fecha_solicitud.strftime('%Y-%m-%d'),
            'comentarios': 'No requiere niveles de aprobación.',
        })

    hubo_rechazo = False
    for j in jerarquia:
        ap    = aprobaciones.get(j.nivel_aprobacion)
        label = labels.get(j.nivel_aprobacion, f'Nivel {j.nivel_aprobacion}')

        # Si ya hay decisión, mostrar quien realmente la tomó (puede ser un aprobador anterior).
        # Si está pendiente, mostrar el aprobador activo actual del nivel.
        if ap:
            dec = ap.cod_aprobador.ci
            nombre_ap = f"{dec.nombre} {dec.ap_paterno} {dec.ap_materno or ''}".strip()
        else:
            cur = j.cod_aprobador.ci
            nombre_ap = f"{cur.nombre} {cur.ap_paterno} {cur.ap_materno or ''}".strip()

        if hubo_rechazo:
            timeline.append({
                'nivel': label, 'responsable': nombre_ap,
                'estado': 'inactive', 'fecha': None, 'comentarios': None,
            })
            continue

        if ap:
            es_rechazo = ap.decision.upper() == 'RECHAZADO'
            if es_rechazo:
                hubo_rechazo = True
            timeline.append({
                'nivel': label,
                'responsable': nombre_ap,
                'estado': 'rejected' if es_rechazo else 'approved',
                'fecha': ap.fecha_decision.strftime('%Y-%m-%d'),
                'comentarios': ap.observacion or '',
            })
        else:
            timeline.append({
                'nivel': label, 'responsable': nombre_ap,
                'estado': 'pending', 'fecha': None, 'comentarios': None,
            })

    return JsonResponse({
        'tiene_solicitud': True,
        'id': solicitud.id_formulario,
        'codigo': f"G{solicitud.id_formulario:03d}",
        'estado': _estado_display(solicitud.estado),
        'timeline': timeline,
    })


# ══════════════════════════════════════════════════════════════════════════════
#  MÓDULO: APROBACIÓN Y/O RECHAZO
# ══════════════════════════════════════════════════════════════════════════════

_ROLES_APROBADOR = {'Jefe de Area', 'Gerente Administrativo', 'Gerente de Salud', 'Gerente General'}
_ESTADOS_MAPA_SIGUIENTE = {1: 'PENDIENTE_GERENTE_AREA', 2: 'PENDIENTE_GERENTE_GENERAL'}


# ──────────────────────────────────────────────────────────────
#  Página HTML
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def aprobacion_view(request):
    return render(request, 'vacations/Aprobación_Rechazo.html')


# ──────────────────────────────────────────────────────────────
#  API: solicitudes que le corresponden aprobar (GET)
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def solicitudes_para_aprobar(request):
    try:
        aprobador = _get_funcionario(request)
    except Funcionario.DoesNotExist:
        return JsonResponse({'error': 'Funcionario no encontrado.'}, status=404)

    roles = set(FuncionarioRol.objects.filter(
        cod_funcionario=aprobador, activo=True
    ).values_list('id_roles__tipo_rol', flat=True))

    es_admin = 'Administrador' in roles
    tiene_rol_aprobador = bool(roles & _ROLES_APROBADOR)

    if not es_admin and not tiene_rol_aprobador:
        return JsonResponse({'error': 'Sin permiso de aprobación.'}, status=403)

    # Rol principal para mostrar en UI
    rol_display = next(
        (r for r in [
            'Gerente General', 'Gerente Administrativo', 'Gerente de Salud',
            'Jefe de Area', 'Administrador',
        ] if r in roles),
        'Aprobador'
    )

    # Determinar solicitudes a mostrar
    if tiene_rol_aprobador:
        # Aprobador: solicitudes donde es aprobador en jerarquía
        jerarquias_qs = list(JerarquiaAprobacion.objects.filter(
            cod_aprobador=aprobador, activo=True
        ).values('cod_funcionario_id', 'nivel_aprobacion'))

        mi_nivel_por_func = {j['cod_funcionario_id']: j['nivel_aprobacion'] for j in jerarquias_qs}
        cod_funcs = list(mi_nivel_por_func.keys())

        solicitudes_qs = list(SolicitudVacacion.objects.filter(
            cod_funcionario__in=cod_funcs
        ).select_related(
            'cod_funcionario__ci', 'cod_funcionario__id_unidad'
        ).order_by('-fecha_solicitud'))

    else:
        # Admin-only: todas las solicitudes pendientes (solo lectura)
        mi_nivel_por_func = {}
        solicitudes_qs = list(SolicitudVacacion.objects.filter(
            estado__in=list(_ESTADOS_PENDIENTE)
        ).select_related(
            'cod_funcionario__ci', 'cod_funcionario__id_unidad'
        ).order_by('-fecha_solicitud'))

    roles_lista = sorted(roles, key=lambda r: (r != 'Funcionario', r))
    if 'Funcionario' not in roles_lista:
        roles_lista.insert(0, 'Funcionario')

    if not solicitudes_qs:
        return JsonResponse({
            'aprobador': {
                'nombre': f"{aprobador.ci.nombre} {aprobador.ci.ap_paterno}".strip(),
                'rol': rol_display,
                'cod': aprobador.cod_funcionario,
                'roles': roles_lista,
            },
            'puede_aprobar': tiene_rol_aprobador,
            'solicitudes': [],
            'contadores': {'pendientes': 0, 'aprobadas': 0},
        })

    # Datos en batch
    sol_ids = [s.id_formulario for s in solicitudes_qs]
    cod_funcs_sol = list({s.cod_funcionario_id for s in solicitudes_qs})

    aprobaciones_por_sol = {}
    for ap in AprobacionSolicitud.objects.filter(
        id_formulario__in=sol_ids
    ).select_related('cod_aprobador__ci'):
        aprobaciones_por_sol.setdefault(ap.id_formulario_id, {})[ap.nivel] = ap

    cargos = {
        h.cod_funcionario_id: h
        for h in HistorialCargo.objects.filter(
            cod_funcionario__in=cod_funcs_sol, es_actual=True
        )
    }

    gestiones = {
        gv.cod_funcionario_id: gv
        for gv in GestionVacacion.objects.filter(cod_funcionario__in=cod_funcs_sol)
    }

    jerarquias_por_func = {}
    for j in JerarquiaAprobacion.objects.filter(
        cod_funcionario__in=cod_funcs_sol, activo=True
    ).select_related('cod_aprobador__ci').order_by('nivel_aprobacion'):
        jerarquias_por_func.setdefault(j.cod_funcionario_id, []).append(j)

    resultado = []
    for sol in solicitudes_qs:
        f = sol.cod_funcionario
        p = f.ci
        cargo_act = cargos.get(f.cod_funcionario)
        gv = gestiones.get(f.cod_funcionario)
        aprs = aprobaciones_por_sol.get(sol.id_formulario, {})
        mi_nivel = mi_nivel_por_func.get(f.cod_funcionario)

        # ¿Puede actuar este aprobador?
        if mi_nivel is not None and sol.estado not in ('APROBADA', 'RECHAZADA'):
            prev_ok = all(
                aprs.get(n) and aprs[n].decision.upper() == 'APROBADO'
                for n in range(1, mi_nivel)
            )
            puede_actuar = prev_ok and (mi_nivel not in aprs)
        else:
            puede_actuar = False

        # Flujo visual
        labels = _NIVEL_LABELS.get(f.tipo_funcionario, {})
        flujo = []
        for j in jerarquias_por_func.get(f.cod_funcionario, []):
            ap = aprs.get(j.nivel_aprobacion)
            # Nombre: quien realmente decidió si ya hay decisión, o el aprobador activo actual
            if ap:
                dec = ap.cod_aprobador.ci
                nombre_apr = f"{dec.nombre} {dec.ap_paterno}".strip()
            else:
                nombre_apr = f"{j.cod_aprobador.ci.nombre} {j.cod_aprobador.ci.ap_paterno}".strip()
            flujo.append({
                'nivel': j.nivel_aprobacion,
                'label': labels.get(j.nivel_aprobacion, f'Nivel {j.nivel_aprobacion}'),
                'nombre_aprobador': nombre_apr,
                'decision': ap.decision if ap else None,
                'fecha': ap.fecha_decision.strftime('%Y-%m-%d') if ap else None,
                'observacion': ap.observacion if ap else None,
                'es_mi_nivel': j.nivel_aprobacion == mi_nivel,
            })

        # Saldo: reconstructed "antes" = current + solicited
        dias_adeudados_actual = float(gv.dias_adeudados or 0) if gv else 0
        saldo_antes = round(dias_adeudados_actual + float(sol.dias_solicitados), 1)
        saldo_despues = round(dias_adeudados_actual, 1)

        resultado.append({
            'id': sol.id_formulario,
            'codigo': f"G{sol.id_formulario:03d}",
            'cod_funcionario': f.cod_funcionario,
            'funcionario': f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip(),
            'cargo': cargo_act.cargo if cargo_act else '',
            'tipo_contrato': cargo_act.tipo_contrato if cargo_act else '',
            'unidad': f.id_unidad.nombre if f.id_unidad else '',
            'fecha_solicitud': sol.fecha_solicitud.strftime('%Y-%m-%d'),
            'fecha_salida': sol.fecha_salida.strftime('%Y-%m-%d'),
            'fecha_retorno': sol.fecha_retorno.strftime('%Y-%m-%d'),
            'dias': float(sol.dias_solicitados),
            'motivo': sol.motivo_vacacion or '',
            'estado_db': sol.estado,
            'estado_display': _estado_display(sol.estado),
            'saldo_antes': saldo_antes,
            'saldo_despues': saldo_despues,
            'mi_nivel': mi_nivel,
            'puede_actuar': puede_actuar,
            'flujo': flujo,
        })

    pendientes_count = sum(1 for r in resultado if r['puede_actuar'])
    aprobadas_count = sum(1 for r in resultado if r['estado_db'] == 'APROBADA')

    return JsonResponse({
        'aprobador': {
            'nombre': f"{aprobador.ci.nombre} {aprobador.ci.ap_paterno}".strip(),
            'rol': rol_display,
            'cod': aprobador.cod_funcionario,
            'roles': roles_lista,
        },
        'puede_aprobar': tiene_rol_aprobador,
        'solicitudes': resultado,
        'contadores': {'pendientes': pendientes_count, 'aprobadas': aprobadas_count},
    })


# ──────────────────────────────────────────────────────────────
#  API: registrar decisión de aprobación (POST)
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
@require_POST
def registrar_decision(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Solicitud inválida.'}, status=400)

    id_formulario = data.get('id_formulario')
    decision = str(data.get('decision', '')).upper().strip()
    observacion = data.get('observacion', '').strip()

    if not id_formulario or decision not in ('APROBADO', 'RECHAZADO'):
        return JsonResponse({'error': 'Datos inválidos.'}, status=400)

    if decision == 'RECHAZADO' and len(observacion) < 10:
        return JsonResponse(
            {'error': 'Para rechazar debe ingresar un motivo (mínimo 10 caracteres).'}, status=400
        )

    try:
        aprobador = _get_funcionario(request)
    except Funcionario.DoesNotExist:
        return JsonResponse({'error': 'Aprobador no encontrado.'}, status=404)

    try:
        solicitud = SolicitudVacacion.objects.select_related(
            'cod_funcionario__ci'
        ).get(id_formulario=id_formulario)
    except SolicitudVacacion.DoesNotExist:
        return JsonResponse({'error': 'Solicitud no encontrada.'}, status=404)

    if solicitud.estado in ('APROBADA', 'RECHAZADA'):
        return JsonResponse({'error': 'Esta solicitud ya fue procesada.'}, status=400)

    # Verificar que el aprobador tiene autoridad para esta solicitud
    try:
        jerarquia = JerarquiaAprobacion.objects.get(
            cod_funcionario=solicitud.cod_funcionario,
            cod_aprobador=aprobador,
            activo=True,
        )
    except JerarquiaAprobacion.DoesNotExist:
        return JsonResponse({'error': 'No tiene autoridad para aprobar esta solicitud.'}, status=403)

    mi_nivel = jerarquia.nivel_aprobacion

    # Verificar que los niveles anteriores aprobaron
    aprs = {
        ap.nivel: ap
        for ap in AprobacionSolicitud.objects.filter(id_formulario=solicitud)
    }

    for n in range(1, mi_nivel):
        if not aprs.get(n) or aprs[n].decision.upper() != 'APROBADO':
            return JsonResponse(
                {'error': f'El nivel {n} aún no ha aprobado la solicitud.'}, status=400
            )

    if mi_nivel in aprs:
        return JsonResponse({'error': 'Ya emitió su decisión sobre esta solicitud.'}, status=400)

    solicitante = solicitud.cod_funcionario

    try:
        with transaction.atomic():
            AprobacionSolicitud.objects.create(
                id_formulario=solicitud,
                cod_aprobador=aprobador,
                nivel=mi_nivel,
                decision=decision,
                observacion=observacion or None,
            )

            if decision == 'RECHAZADO':
                solicitud.estado = 'RECHAZADA'
                solicitud.save(update_fields=['estado'])

                # Devolver días a la gestión más antigua (gestion4 primero)
                try:
                    gv = GestionVacacion.objects.get(cod_funcionario=solicitante)
                    a_devolver = solicitud.dias_solicitados
                    for i in range(4, 0, -1):
                        if a_devolver <= 0:
                            break
                        campo = f'dias_gestion{i}'
                        anio = getattr(gv, f'anio_gestion{i}')
                        if anio is not None or i == 4:
                            setattr(gv, campo, getattr(gv, campo) + a_devolver)
                            a_devolver = Decimal('0')
                    gv.save(update_fields=[
                        'dias_gestion1', 'dias_gestion2', 'dias_gestion3', 'dias_gestion4'
                    ])
                except GestionVacacion.DoesNotExist:
                    pass

            else:  # APROBADO
                total_niveles = JerarquiaAprobacion.objects.filter(
                    cod_funcionario=solicitante, activo=True
                ).count()

                if mi_nivel >= total_niveles:
                    solicitud.estado = 'APROBADA'
                else:
                    solicitud.estado = _ESTADOS_MAPA_SIGUIENTE.get(
                        mi_nivel, 'PENDIENTE_GERENTE_GENERAL'
                    )
                solicitud.save(update_fields=['estado'])

    except Exception as e:
        return JsonResponse({'error': f'Error al procesar la decisión: {e}'}, status=500)

    return JsonResponse({
        'ok': True,
        'decision': decision,
        'nuevo_estado': _estado_display(solicitud.estado),
        'codigo': f"G{solicitud.id_formulario:03d}",
    })


# ══════════════════════════════════════════════════════════════════════════════
#  MÓDULO: GESTIÓN DE SALDO DE VACACIONES (RRHH)
# ══════════════════════════════════════════════════════════════════════════════

_ROLES_RRHH = {'RRHH', 'Administrador'}


def _get_usuario_rrhh(request):
    """Devuelve (funcionario, roles) si el usuario tiene rol RRHH/Administrador."""
    ci = request.user.username
    f = Funcionario.objects.select_related('ci').get(ci__ci=ci, estado='ACTIVO')
    roles = set(FuncionarioRol.objects.filter(
        cod_funcionario=f, activo=True
    ).values_list('id_roles__tipo_rol', flat=True))
    return f, roles


@login_required(login_url='login_home')
@require_POST
def acreditar_gestion(request):
    """
    Acredita los días de vacación correspondientes a una gestión anual.
    Calcula automáticamente los días según la Ley General del Trabajo
    en base a los años de antigüedad del funcionario.

    Body JSON: { cod_funcionario, anio_gestion }
    """
    try:
        _, roles = _get_usuario_rrhh(request)
    except Funcionario.DoesNotExist:
        return JsonResponse({'error': 'Funcionario no encontrado.'}, status=404)

    if not (roles & _ROLES_RRHH):
        return JsonResponse({'error': 'Sin permiso. Se requiere rol RRHH o Administrador.'}, status=403)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Solicitud inválida.'}, status=400)

    cod_funcionario = str(data.get('cod_funcionario', '')).strip()
    anio_raw = data.get('anio_gestion')

    if not cod_funcionario or anio_raw is None:
        return JsonResponse({'error': 'cod_funcionario y anio_gestion son requeridos.'}, status=400)

    try:
        anio_gestion = int(anio_raw)
        if anio_gestion < 2000 or anio_gestion > date.today().year:
            raise ValueError
    except (ValueError, TypeError):
        return JsonResponse({'error': 'anio_gestion inválido.'}, status=400)

    try:
        funcionario = Funcionario.objects.select_related('ci').get(cod_funcionario=cod_funcionario)
    except Funcionario.DoesNotExist:
        return JsonResponse({'error': 'Funcionario no encontrado.'}, status=404)

    # Antigüedad al cierre de la gestión solicitada
    referencia = date(anio_gestion, 12, 31)
    anios = calcular_anios_antiguedad(funcionario.fecha_ingreso, referencia)

    if anios < 1:
        return JsonResponse(
            {'error': f'El funcionario no completó 1 año de servicio en la gestión {anio_gestion}.'},
            status=400
        )

    dias = dias_por_antiguedad(anios)

    try:
        gv = GestionVacacion.objects.get(cod_funcionario=funcionario)
    except GestionVacacion.DoesNotExist:
        gv = GestionVacacion(cod_funcionario=funcionario)

    # Verificar que la gestión no esté ya acreditada
    for i in range(1, 5):
        if getattr(gv, f'anio_gestion{i}') == anio_gestion:
            return JsonResponse(
                {'error': f'La gestión {anio_gestion} ya fue acreditada para este funcionario.'},
                status=400
            )

    # Encontrar slot disponible: primero vacíos (anio=None), luego consumidos (dias=0)
    slot = None
    for i in range(4, 0, -1):
        if getattr(gv, f'anio_gestion{i}') is None:
            slot = i
            break
    if slot is None:
        for i in range(4, 0, -1):
            if getattr(gv, f'dias_gestion{i}') == 0:
                slot = i
                break

    if slot is None:
        return JsonResponse(
            {'error': 'No hay slots disponibles. El funcionario tiene 4 gestiones pendientes de uso.'},
            status=400
        )

    setattr(gv, f'anio_gestion{slot}', anio_gestion)
    setattr(gv, f'dias_gestion{slot}', dias)

    if gv.pk:
        gv.save(update_fields=[f'anio_gestion{slot}', f'dias_gestion{slot}'])
    else:
        gv.save()

    p = funcionario.ci
    return JsonResponse({
        'ok': True,
        'funcionario': f"{p.nombre} {p.ap_paterno}".strip(),
        'anio_gestion': anio_gestion,
        'anios_antiguedad': anios,
        'dias_acreditados': float(dias),
        'slot': slot,
    }, status=201)


@login_required(login_url='login_home')
@require_POST
def inicializar_vacaciones(request):
    """
    Acredita automáticamente todas las gestiones pendientes a uno o todos los
    funcionarios activos, según la Ley General del Trabajo.

    Body JSON: { cod_funcionario: "..." }   ← opcional; si se omite, procesa todos.
    """
    try:
        _, roles = _get_usuario_rrhh(request)
    except Funcionario.DoesNotExist:
        return JsonResponse({'error': 'Funcionario no encontrado.'}, status=404)

    if not (roles & _ROLES_RRHH):
        return JsonResponse({'error': 'Sin permiso. Se requiere rol RRHH o Administrador.'}, status=403)

    try:
        data = json.loads(request.body) if request.body else {}
    except (json.JSONDecodeError, ValueError):
        data = {}

    cod_funcionario = str(data.get('cod_funcionario', '')).strip()

    qs = Funcionario.objects.select_related('ci').filter(estado='ACTIVO')
    if cod_funcionario:
        qs = qs.filter(cod_funcionario=cod_funcionario)
        if not qs.exists():
            return JsonResponse({'error': 'Funcionario no encontrado.'}, status=404)

    procesados = []
    omitidos = []

    for f in qs:
        stats = poblar_gestion_vacacion(f)
        nombre = f"{f.ci.nombre} {f.ci.ap_paterno}".strip()
        if stats['sin_elegibilidad']:
            omitidos.append({'cod': f.cod_funcionario, 'nombre': nombre, 'motivo': 'Sin antigüedad suficiente'})
        elif stats['acreditadas'] == 0:
            omitidos.append({'cod': f.cod_funcionario, 'nombre': nombre, 'motivo': 'Gestiones ya acreditadas'})
        else:
            procesados.append({
                'cod': f.cod_funcionario,
                'nombre': nombre,
                'gestiones_acreditadas': stats['acreditadas'],
            })

    return JsonResponse({
        'ok': True,
        'procesados': procesados,
        'omitidos': omitidos,
        'resumen': {
            'total_procesados': len(procesados),
            'total_omitidos': len(omitidos),
        },
    })


# ══════════════════════════════════════════════════════════════════════════════
#  MÓDULO: HISTORIAL DE SOLICITUDES DE VACACIÓN (RRHH)
# ══════════════════════════════════════════════════════════════════════════════

_ROLES_HISTORIAL = {'RRHH', 'Administrador'}

_PDF_FIRMAS = {
    'PERSONAL DE AREA': [
        ('Firma Jefe de Área', 1),
        ('Firma de Gerente de\nSalud o Administrativo', 2),
        ('Firma de Gerente General', 3),
    ],
    'JEFE AREA': [
        ('Firma de Gerente de\nSalud o Administrativo', 1),
        ('Firma de Gerente General', 2),
    ],
    'GERENTE ADMINISTRATIVO': [('Firma de Gerente General', 1)],
    'GERENTE SALUD':          [('Firma de Gerente General', 1)],
    'DEPENDENCIA DIRECTA':    [('Firma de Gerente General', 1)],
    'GERENTE GENERAL':        [],
}


def _check_acceso_historial(request):
    ci = request.user.username
    try:
        f = Funcionario.objects.get(ci__ci=ci, estado='ACTIVO')
    except Funcionario.DoesNotExist:
        return False, None
    roles = set(FuncionarioRol.objects.filter(
        cod_funcionario=f, activo=True
    ).values_list('id_roles__tipo_rol', flat=True))
    return bool(roles & _ROLES_HISTORIAL), f


# ──────────────────────────────────────────────────────────────
#  Página HTML
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def historial_rrhh_view(request):
    tiene_acceso, _ = _check_acceso_historial(request)
    if not tiene_acceso:
        return render(request, 'shared/sin_acceso.html', status=403)
    return render(request, 'vacations/Frm_Solicitud.html')


# ──────────────────────────────────────────────────────────────
#  API: listado de solicitudes aprobadas (GET)
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def api_historial_rrhh(request):
    tiene_acceso, f_user = _check_acceso_historial(request)
    if not tiene_acceso:
        return JsonResponse({'error': 'Sin acceso.'}, status=403)

    unidad_id = request.GET.get('unidad', '').strip()
    tipo_cont = request.GET.get('tipo_contrato', '').strip()
    nombre_b  = request.GET.get('funcionario', '').strip()

    # Corregir en lote solicitudes pendientes de funcionarios sin niveles de aprobación
    # (ej. GERENTE_GENERAL) que quedaron atrapadas antes del fix de auto-aprobación.
    from django.db.models import Exists, OuterRef
    SolicitudVacacion.objects.filter(
        estado__in=list(_ESTADOS_PENDIENTE)
    ).exclude(
        cod_funcionario__in=JerarquiaAprobacion.objects.filter(
            activo=True
        ).values('cod_funcionario')
    ).update(estado='APROBADA')

    qs = SolicitudVacacion.objects.filter(estado='APROBADA').select_related(
        'cod_funcionario__ci', 'cod_funcionario__id_unidad'
    ).order_by('-fecha_solicitud')

    if unidad_id:
        qs = qs.filter(cod_funcionario__id_unidad=unidad_id)

    if tipo_cont:
        cods = HistorialCargo.objects.filter(
            es_actual=True, tipo_contrato=tipo_cont
        ).values_list('cod_funcionario', flat=True)
        qs = qs.filter(cod_funcionario__in=cods)

    if nombre_b:
        qs = qs.filter(
            Q(cod_funcionario__ci__nombre__icontains=nombre_b) |
            Q(cod_funcionario__ci__ap_paterno__icontains=nombre_b)
        )

    from django.db.models import Sum

    sol_list = list(qs)
    sol_ids   = [s.id_formulario for s in sol_list]
    cod_funcs = list({s.cod_funcionario_id for s in sol_list})

    cargos = {
        h.cod_funcionario_id: h
        for h in HistorialCargo.objects.filter(cod_funcionario__in=cod_funcs, es_actual=True)
    }
    gestiones = {
        gv.cod_funcionario_id: gv
        for gv in GestionVacacion.objects.filter(cod_funcionario__in=cod_funcs)
    }

    ajustes_parciales = {
        row['id_formulario']: float(row['total'])
        for row in AnulacionAjuste.objects.filter(
            id_formulario__in=sol_ids,
            tipo_anulacion='AJUSTE',
        ).values('id_formulario').annotate(total=Sum('dias_devolver'))
    }

    unidades = list(
        UnidadOrganizacional.objects.filter(activo=True)
        .values('id_unidad', 'nombre').order_by('nombre')
    )
    tipos_contrato = list(
        HistorialCargo.objects.filter(es_actual=True)
        .values_list('tipo_contrato', flat=True)
        .distinct().order_by('tipo_contrato')
    )

    resultado = []
    for sol in sol_list:
        f = sol.cod_funcionario
        p = f.ci
        cargo_act      = cargos.get(f.cod_funcionario)
        gv             = gestiones.get(f.cod_funcionario)
        dias_ajustados = ajustes_parciales.get(sol.id_formulario, 0.0)
        resultado.append({
            'id': sol.id_formulario,
            'codigo': f"G{sol.id_formulario:03d}",
            'funcionario': f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip(),
            'cargo': cargo_act.cargo if cargo_act else '—',
            'tipo_contrato': cargo_act.tipo_contrato if cargo_act else '—',
            'unidad': f.id_unidad.nombre if f.id_unidad else '—',
            'fecha_solicitud': sol.fecha_solicitud.strftime('%Y-%m-%d'),
            'fecha_salida': sol.fecha_salida.strftime('%Y-%m-%d'),
            'fecha_retorno': sol.fecha_retorno.strftime('%Y-%m-%d'),
            'dias': float(sol.dias_solicitados) - dias_ajustados,
            'dias_adeudados': float(gv.dias_adeudados or 0) if gv else 0.0,
        })

    roles_activos = list(FuncionarioRol.objects.filter(
        cod_funcionario=f_user, activo=True
    ).values_list('id_roles__tipo_rol', flat=True))
    if 'Funcionario' not in roles_activos:
        roles_activos.insert(0, 'Funcionario')

    return JsonResponse({
        'solicitudes': resultado,
        'filtros': {
            'unidades': unidades,
            'tipos_contrato': tipos_contrato,
        },
        'usuario': {
            'nombre': f"{f_user.ci.nombre} {f_user.ci.ap_paterno}".strip(),
            'roles': roles_activos,
        },
    })


# ──────────────────────────────────────────────────────────────
#  API: descarga de PDF (GET)
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def api_descargar_pdf(request, id_formulario):
    tiene_acceso, _ = _check_acceso_historial(request)
    if not tiene_acceso:
        return JsonResponse({'error': 'Sin acceso.'}, status=403)

    try:
        solicitud = SolicitudVacacion.objects.select_related(
            'cod_funcionario__ci', 'cod_funcionario__id_unidad'
        ).get(id_formulario=id_formulario, estado='APROBADA')
    except SolicitudVacacion.DoesNotExist:
        return JsonResponse({'error': 'Solicitud aprobada no encontrada.'}, status=404)

    pdf_bytes = _generar_pdf_solicitud(solicitud)
    cod = f"G{solicitud.id_formulario:03d}"
    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="Vacacion_{cod}.pdf"'
    return response


# ──────────────────────────────────────────────────────────────
#  Helper: generación del formulario PDF
# ──────────────────────────────────────────────────────────────

def _generar_pdf_solicitud(solicitud):
    import os
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=1.5*cm, bottomMargin=1.5*cm,
    )
    W = A4[0] - 4*cm  # ancho útil

    f    = solicitud.cod_funcionario
    p    = f.ci
    tipo = f.tipo_funcionario
    fs   = solicitud.fecha_solicitud

    from django.db.models import Sum as _Sum

    cargo_act = HistorialCargo.objects.filter(cod_funcionario=f, es_actual=True).first()
    try:
        gv = GestionVacacion.objects.get(cod_funcionario=f)
    except GestionVacacion.DoesNotExist:
        gv = None

    # Días efectivos: original menos ajustes parciales ya registrados
    ya_ajustados_pdf = AnulacionAjuste.objects.filter(
        id_formulario=solicitud, tipo_anulacion='AJUSTE'
    ).aggregate(total=_Sum('dias_devolver'))['total'] or Decimal('0')
    dias_efectivos_pdf = solicitud.dias_solicitados - ya_ajustados_pdf

    # Aprobadores históricos
    aprobadores = {}
    for n in range(1, 4):
        ja = JerarquiaAprobacion.objects.filter(
            cod_funcionario=f, nivel_aprobacion=n,
            fecha_inicio__lte=fs,
        ).filter(
            Q(fecha_fin__isnull=True) | Q(fecha_fin__gte=fs)
        ).select_related('cod_aprobador__ci').first()
        if ja:
            aprobadores[n] = ja.cod_aprobador

    # RRHH histórico
    rrhh_fr = FuncionarioRol.objects.filter(
        id_roles__tipo_rol='RRHH',
        fecha_asignacion__lte=fs,
    ).filter(
        Q(fecha_revocacion__isnull=True) | Q(fecha_revocacion__gte=fs)
    ).select_related('cod_funcionario__ci').first()
    rrhh_nombre = (
        f"{rrhh_fr.cod_funcionario.ci.nombre} {rrhh_fr.cod_funcionario.ci.ap_paterno}".strip()
        if rrhh_fr else '—'
    )

    # ── Colores (según modelo) ───────────────────────────────
    HDR_RED  = colors.HexColor('#F2949C')   # rojo oscuro — encabezados de sección
    COD_PINK = colors.HexColor('#F2949C')   # rosa suave  — fila cod. solicitud
    GRAY     = colors.HexColor("#000000")   # gris claro  — bordes y líneas de tabla
    BLACK    = colors.black
    WHITE    = colors.white

    # ── Estilos de texto ─────────────────────────────────────
    def sty(fname, fsize, align=TA_LEFT, color=BLACK, leading=None):
        return ParagraphStyle(
            f'{fname}_{fsize}_{align}_{id(color)}',
            fontName=fname, fontSize=fsize,
            alignment=align,
            leading=leading or (fsize + 2),
            textColor=color,
        )

    sTitle   = sty('Helvetica-Bold', 12, TA_CENTER)
    sSection = sty('Helvetica-Bold',  8, TA_CENTER, BLACK)
    sCod     = sty('Helvetica-Bold',  9)
    sLabel   = sty('Helvetica-Bold',  8)
    sVal     = sty('Helvetica',       8)
    sCenter  = sty('Helvetica',       7, TA_CENTER)
    sBCenter = sty('Helvetica-Bold',  7, TA_CENTER)
    sSmall   = sty('Helvetica',       7)
    sSmallB  = sty('Helvetica-Bold',  7)

    def P(txt, style): return Paragraph(str(txt), style)

    # ── Estilos de tabla reutilizables ───────────────────────
    HDR_TS = TableStyle([
        ('BACKGROUND',    (0, 0), (-1, -1), HDR_RED),
        ('BOX',           (0, 0), (-1, -1), 0.5, BLACK),
        ('TOPPADDING',    (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING',   (0, 0), (-1, -1), 6),
    ])
    DATA_TS = TableStyle([
        ('BOX',           (0, 0), (-1, -1), 0.5, BLACK),
        ('INNERGRID',     (0, 0), (-1, -1), 0.25, GRAY),
        ('TOPPADDING',    (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING',   (0, 0), (-1, -1), 6),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
    ])

    def section_hdr(text):
        t = Table([[P(text, sSection)]], colWidths=[W])
        t.setStyle(HDR_TS)
        return t

    def data_tbl(rows, widths):
        t = Table(rows, colWidths=widths)
        t.setStyle(DATA_TS)
        return t

    # ── Logo ─────────────────────────────────────────────────
    logo_path = os.path.normpath(
        os.path.join(os.path.dirname(__file__), '..', 'static', 'img', 'login', 'LOGOSSU.png')
    )
    logo_cell = (
        Image(logo_path, width=6*cm, height=6*cm)
        if os.path.exists(logo_path) else P('', sVal)
    )

    elements = []

    # ── Título ───────────────────────────────────────────────
    elements.append(P('<u><b>FORMULARIO DE SOLICITUD VACACIÓN</b></u>', sTitle))
    elements.append(Spacer(1, 0.2*cm))

    # ── Cabecera: Cod. Solicitud | Logo ──────────────────────
    cod_sol = f"G{solicitud.id_formulario:03d}"
    nombre_completo = f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip()

    # Tabla unificada: [cod+datos del empleado | logo] con SPAN en logo
    wL = W * 0.65   # columna izquierda (labels + valores)
    wR = W * 0.35   # columna derecha  (logo)
    wLa = wL * 0.38  # sub-col label
    wLb = wL * 0.62  # sub-col valor

    # Construimos como una tabla de 3 columnas: label | valor | logo(span)
    hdr_datos = Table([
        # fila 0: Cod. solicitud | Logo (span 6 filas)
        [P(f'Cod. Solicitud / {cod_sol}', sCod), '', logo_cell],
        # fila 1: encabezado DATOS DEL EMPLEADO (span 2 cols)
        [P('DATOS DEL EMPLEADO', sSection), '', ''],
        # filas 2-6: datos del empleado
        [P('Carnet:', sLabel),                P(p.ci, sVal),                ''],
        [P('Nombre Completo:', sLabel),        P(nombre_completo, sVal),     ''],
        [P('Unidad Organizacional:', sLabel),  P(f.id_unidad.nombre if f.id_unidad else '—', sVal), ''],
        [P('Cargo:', sLabel),                  P(cargo_act.cargo if cargo_act else '—', sVal), ''],
        [P('Fecha Nominal:', sLabel),          P(f.fecha_ingreso.strftime('%d/%m/%Y') if f.fecha_ingreso else '—', sVal), ''],
    ], colWidths=[wLa, wLb, wR])

    hdr_datos.setStyle(TableStyle([
        # Bordes generales
        ('BOX',           (0, 0), (-1, -1), 0.5, BLACK),
        ('INNERGRID',     (0, 0), (-1, -1), 0.25, GRAY),
        ('TOPPADDING',    (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING',   (0, 0), (-1, -1), 6),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),

        # Fila 0: Cod. solicitud — fondo rosa, span cols 0-1
        ('SPAN',          (0, 0), (1, 0)),
        ('BACKGROUND',    (0, 0), (1, 0), COD_PINK),

        # Fila 1: DATOS DEL EMPLEADO — fondo rojo, span cols 0-1, texto blanco
        ('SPAN',          (0, 1), (1, 1)),
        ('BACKGROUND',    (0, 1), (1, 1), HDR_RED),
        ('TEXTCOLOR',     (0, 1), (1, 1), WHITE),
        ('ALIGN',         (0, 1), (1, 1), 'CENTER'),

        # Logo: span filas 0-6 en col 2, centrado
        ('SPAN',          (2, 0), (2, 6)),
        ('ALIGN',         (2, 0), (2, 6), 'CENTER'),
        ('VALIGN',        (2, 0), (2, 6), 'MIDDLE'),
        ('BACKGROUND',    (2, 0), (2, 6), WHITE),

        # Sin grid interno en la celda del logo
        ('LINEAFTER',     (1, 0), (1, 6), 0.5, BLACK),
    ]))
    elements.append(hdr_datos)
    elements.append(Spacer(1, 0.15*cm))

    # ── Periodo de vacaciones ────────────────────────────────
    elements.append(section_hdr("PERIODO DE VACACIONES"))
    w4 = W / 4
    t_periodo = Table([
        [P('Fecha Solicitud:', sLabel), P(fs.strftime('%d/%m/%Y'), sVal),
         P('Días Solicitados:', sLabel), P(str(float(dias_efectivos_pdf)), sVal)],
        [P('Fecha Inicio:', sLabel), P(solicitud.fecha_salida.strftime('%d/%m/%Y'), sVal),
         P('Fecha Final:', sLabel), P(solicitud.fecha_retorno.strftime('%d/%m/%Y'), sVal)],
        [P('Descripción:', sLabel), P(solicitud.motivo_vacacion or '—', sVal), '', ''],
    ], colWidths=[w4, w4, w4, w4])
    t_periodo.setStyle(TableStyle([
        ('BOX',           (0, 0), (-1, -1), 0.5, BLACK),
        ('INNERGRID',     (0, 0), (-1, -1), 0.25, GRAY),
        ('TOPPADDING',    (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING',   (0, 0), (-1, -1), 6),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ('SPAN',          (1, 2), (3, 2)),
    ]))
    elements.append(t_periodo)
    elements.append(Spacer(1, 0.15*cm))

    # ── Días pendientes ──────────────────────────────────────
    elements.append(section_hdr("DÍAS PENDIENTES DE VACACIONES DESPUÉS DE LA SOLICITUD"))

    def gest(i):
        if gv:
            anio = getattr(gv, f'anio_gestion{i}')
            dias = float(getattr(gv, f'dias_gestion{i}'))
            label = f"Gestión {anio}:" if anio else f"Gestión {i}:"
            return label, f"{dias:.1f}"
        return f"Gestión {i}:", "0.0"

    g1l, g1v = gest(1); g2l, g2v = gest(2)
    g3l, g3v = gest(3); g4l, g4v = gest(4)
    saldo_val = f"{float(gv.dias_adeudados or 0):.1f}" if gv else "0.0"

    wa, wb, wc = W * 0.18, W * 0.24, W * 0.08
    t_dias = Table([
        [P(g1l, sLabel), P('Días disponibles:', sLabel), P(g1v, sVal),
         P(g2l, sLabel), P('Días Disponibles:', sLabel), P(g2v, sVal)],
        [P(g3l, sLabel), P('Días disponibles:', sLabel), P(g3v, sVal),
         P(g4l, sLabel), P('Días Disponibles:', sLabel), P(g4v, sVal)],
        [P('', sVal),    P('', sVal),                   P('', sVal),
         P('', sVal),    P('Saldo:', sLabel),            P(saldo_val, sVal)],
    ], colWidths=[wa, wb, wc, wa, wb, wc])
    t_dias.setStyle(TableStyle([
        ('BOX',           (0, 0), (-1, -1), 0.5, BLACK),
        ('INNERGRID',     (0, 0), (-1, -1), 0.25, GRAY),
        ('TOPPADDING',    (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING',   (0, 0), (-1, -1), 5),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    elements.append(t_dias)
    elements.append(Spacer(1, 0.15*cm))

    # ── Vacaciones autorizadas por ───────────────────────────
    elements.append(section_hdr("VACACIONES AUTORIZADAS POR"))

    firmas = _PDF_FIRMAS.get(tipo, [])

    if tipo == 'GERENTE GENERAL':
        t_nap = Table([[P('<b>NO POSEE NIVEL DE APROBACIÓN</b>', sBCenter)]], colWidths=[W])
        t_nap.setStyle(TableStyle([
            ('BOX',           (0, 0), (-1, -1), 0.5, BLACK),
            ('TOPPADDING',    (0, 0), (-1, -1), 20),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 20),
            ('ALIGN',         (0, 0), (-1, -1), 'CENTER'),
        ]))
        elements.append(t_nap)
    else:
        n  = len(firmas)
        fw = W / n
        # Fila de etiquetas (con espacio para la firma encima)
        row_info   = []
        row_labels = []
        for label, nivel in firmas:
            apr = aprobadores.get(nivel)
            if apr:
                nombre_apr = f"{apr.ci.nombre} {apr.ci.ap_paterno} {apr.ci.ap_materno or ''}".strip()
                cod_apr    = apr.cod_funcionario
                info_txt   = f'<b>{nombre_apr}</b><br/><font size="6">Cód: {cod_apr}</font>'
            else:
                info_txt = ''
            row_info.append(P(info_txt, sCenter))
            row_labels.append(P(label, sBCenter))

        t_ap = Table([
            [P('', sVal)] * n,    # espacio para firma
            row_info,              # nombre + código del aprobador
            row_labels,            # etiqueta del rol
        ], colWidths=[fw] * n, rowHeights=[2.2*cm, None, None])
        t_ap.setStyle(TableStyle([
            ('BOX',           (0, 0), (-1, -1), 0.5, BLACK),
            ('INNERGRID',     (0, 0), (-1, -1), 0.5, BLACK),
            ('ALIGN',         (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN',        (0, 0), (-1, 0), 'BOTTOM'),
            ('TOPPADDING',    (0, 1), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 5),
        ]))
        elements.append(t_ap)

    # ── Firma funcionario + RRHH ─────────────────────────────
    wh = W / 2

    func_info = f'<b>{nombre_completo}</b><br/><font size="6">Cód: {f.cod_funcionario}</font>'

    if rrhh_fr:
        rrhh_full = f"{rrhh_fr.cod_funcionario.ci.nombre} {rrhh_fr.cod_funcionario.ci.ap_paterno} {rrhh_fr.cod_funcionario.ci.ap_materno or ''}".strip()
        rrhh_cod  = rrhh_fr.cod_funcionario.cod_funcionario
        rrhh_info = f'<b>{rrhh_full}</b><br/><font size="6">Cód: {rrhh_cod}</font>'
    else:
        rrhh_info = ''

    t_fin = Table([
        [P('', sVal), P('', sVal)],                          # espacio para firma/sello
        [P(func_info, sCenter), P(rrhh_info, sCenter)],      # nombre + código
        [P('Firma funcionario', sBCenter),
         P('Firma del Jefe de Recursos Humanos', sBCenter)],  # etiqueta
    ], colWidths=[wh, wh], rowHeights=[2.2*cm, None, None])
    t_fin.setStyle(TableStyle([
        ('BOX',           (0, 0), (-1, -1), 0.5, BLACK),
        ('INNERGRID',     (0, 0), (-1, -1), 0.5, BLACK),
        ('ALIGN',         (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN',        (0, 0), (-1, 0), 'BOTTOM'),
        ('TOPPADDING',    (0, 1), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 5),
    ]))
    elements.append(t_fin)
    elements.append(Spacer(1, 0.2*cm))

    # ── Nota y fecha de impresión ────────────────────────────
    fecha_imp = date.today().strftime('%d/%m/%Y')
    t_nota = Table([[
        P("Nota: Este documento certifica la conformidad del funcionario con haber presentado y obtenido la aprobación de su solicitud.", sSmall),
        P(f"<b>Fecha:</b> {fecha_imp}", sSmallB),
    ]], colWidths=[W * 0.72, W * 0.28])
    t_nota.setStyle(TableStyle([
        ('TOPPADDING',    (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING',   (0, 0), (-1, -1), 0),
        ('ALIGN',         (1, 0), (1, 0), 'RIGHT'),
        ('VALIGN',        (0, 0), (-1, -1), 'TOP'),
    ]))
    elements.append(t_nota)

    doc.build(elements)
    return buffer.getvalue()


# ══════════════════════════════════════════════════════════════════════════════
#  MÓDULO: ANULACIÓN Y AJUSTE DE VACACIONES (RRHH)
# ══════════════════════════════════════════════════════════════════════════════

@login_required(login_url='login_home')
def anulacion_view(request):
    tiene_acceso, _ = _check_acceso_historial(request)
    if not tiene_acceso:
        return render(request, 'shared/sin_acceso.html', status=403)
    return render(request, 'vacations/Anulación.html')


@login_required(login_url='login_home')
def api_solicitudes_anulacion(request):
    """
    Retorna las solicitudes que completaron TODOS los niveles de aprobación
    (estado APROBADA) y las ya anuladas, para gestión RRHH.
    diasTotales refleja los días efectivos: dias_solicitados menos ajustes parciales ya registrados.
    """
    from django.db.models import Sum

    tiene_acceso, f_user = _check_acceso_historial(request)
    if not tiene_acceso:
        return JsonResponse({'error': 'Sin acceso.'}, status=403)

    qs = (
        SolicitudVacacion.objects
        .filter(estado__in=('APROBADA', 'ANULADA'))
        .select_related('cod_funcionario__ci', 'cod_funcionario__id_unidad')
        .order_by('-fecha_solicitud')
    )

    sol_list  = list(qs)
    sol_ids   = [s.id_formulario for s in sol_list]
    cod_funcs = list({s.cod_funcionario_id for s in sol_list})

    cargos = {
        h.cod_funcionario_id: h
        for h in HistorialCargo.objects.filter(cod_funcionario__in=cod_funcs, es_actual=True)
    }
    gestiones = {
        gv.cod_funcionario_id: gv
        for gv in GestionVacacion.objects.filter(cod_funcionario__in=cod_funcs)
    }

    # Suma de días ya devueltos por ajustes parciales (tipo 'AJUSTE') por solicitud
    ajustes_parciales = {
        row['id_formulario']: float(row['total'])
        for row in AnulacionAjuste.objects.filter(
            id_formulario__in=sol_ids,
            tipo_anulacion='AJUSTE',
        ).values('id_formulario').annotate(total=Sum('dias_devolver'))
    }

    roles_activos = list(FuncionarioRol.objects.filter(
        cod_funcionario=f_user, activo=True
    ).values_list('id_roles__tipo_rol', flat=True))
    if 'Funcionario' not in roles_activos:
        roles_activos.insert(0, 'Funcionario')

    resultado = []
    for sol in sol_list:
        f  = sol.cod_funcionario
        p  = f.ci
        cargo_act      = cargos.get(f.cod_funcionario)
        gv             = gestiones.get(f.cod_funcionario)
        dias_ajustados = ajustes_parciales.get(sol.id_formulario, 0.0)
        dias_efectivos = float(sol.dias_solicitados) - dias_ajustados
        resultado.append({
            'id':          sol.id_formulario,
            'codigo':      f"G{sol.id_formulario:03d}",
            'funcionario': f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip(),
            'cargo':       cargo_act.cargo if cargo_act else '—',
            'fechaInicio': sol.fecha_salida.strftime('%Y-%m-%d'),
            'fechaFinal':  sol.fecha_retorno.strftime('%Y-%m-%d'),
            'diasTotales': dias_efectivos,
            'estado':      'anulada' if sol.estado == 'ANULADA' else 'activa',
            'saldoActual': float(gv.dias_adeudados or 0) if gv else 0.0,
        })

    return JsonResponse({
        'solicitudes': resultado,
        'usuario': {
            'nombre': f"{f_user.ci.nombre} {f_user.ci.ap_paterno}".strip(),
            'roles':  roles_activos,
        },
    })


@login_required(login_url='login_home')
@require_POST
def api_registrar_anulacion(request):
    """
    Registra una anulación total o parcial de una solicitud aprobada.
    Devuelve los días al saldo de gestión del funcionario.
    """
    tiene_acceso, f_rrhh = _check_acceso_historial(request)
    if not tiene_acceso:
        return JsonResponse({'error': 'Sin acceso.'}, status=403)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Solicitud inválida.'}, status=400)

    id_formulario     = data.get('id_formulario')
    tipo_anulacion    = str(data.get('tipo_anulacion', '')).strip().lower()
    motivo_anulacion  = data.get('motivo_anulacion', '').strip()
    observaciones     = data.get('observaciones', '').strip()
    dias_devolver_raw = data.get('dias_devolver')

    if not id_formulario or tipo_anulacion not in ('total', 'parcial'):
        return JsonResponse({'error': 'Datos inválidos.'}, status=400)
    if not motivo_anulacion:
        return JsonResponse({'error': 'El motivo es requerido.'}, status=400)
    if not observaciones or len(observaciones) < 20:
        return JsonResponse(
            {'error': 'Las observaciones deben tener al menos 20 caracteres.'}, status=400
        )

    from django.db.models import Sum as _Sum

    try:
        solicitud = SolicitudVacacion.objects.select_related(
            'cod_funcionario'
        ).get(id_formulario=id_formulario, estado='APROBADA')
    except SolicitudVacacion.DoesNotExist:
        return JsonResponse(
            {'error': 'Solicitud no encontrada o ya fue procesada.'}, status=404
        )

    # Días efectivos = original menos ajustes parciales previos
    ya_ajustados = AnulacionAjuste.objects.filter(
        id_formulario=solicitud, tipo_anulacion='AJUSTE'
    ).aggregate(total=_Sum('dias_devolver'))['total'] or Decimal('0')
    dias_efectivos = solicitud.dias_solicitados - ya_ajustados

    if tipo_anulacion == 'total':
        dias_devolver = dias_efectivos
    else:
        try:
            dias_devolver = Decimal(str(dias_devolver_raw))
            if dias_devolver <= 0 or dias_devolver > dias_efectivos:
                raise ValueError
        except (TypeError, ValueError, InvalidOperation):
            return JsonResponse(
                {'error': f'Días a devolver inválidos. Máximo disponible: {float(dias_efectivos)}.'},
                status=400
            )

    f = solicitud.cod_funcionario
    try:
        gv = GestionVacacion.objects.get(cod_funcionario=f)
    except GestionVacacion.DoesNotExist:
        return JsonResponse(
            {'error': 'Sin registro de gestión para este funcionario.'}, status=400
        )

    # La BD solo acepta 'ANULACION' o 'AJUSTE' en tipo_anulacion
    tipo_db = 'ANULACION' if tipo_anulacion == 'total' else 'AJUSTE'

    try:
        with transaction.atomic():
            AnulacionAjuste.objects.create(
                id_formulario=solicitud,
                tipo_anulacion=tipo_db,
                motivo_anulacion=motivo_anulacion,
                observaciones=observaciones,
                dias_devolver=dias_devolver,
                registrado_por=f_rrhh,
            )

            # Devolver días al slot más reciente con año asignado (igual que en rechazo)
            a_devolver = dias_devolver
            for i in range(4, 0, -1):
                if a_devolver <= 0:
                    break
                if getattr(gv, f'anio_gestion{i}') is not None or i == 4:
                    setattr(gv, f'dias_gestion{i}',
                            getattr(gv, f'dias_gestion{i}') + a_devolver)
                    a_devolver = Decimal('0')
            gv.save(update_fields=[
                'dias_gestion1', 'dias_gestion2', 'dias_gestion3', 'dias_gestion4'
            ])

            if tipo_anulacion == 'total':
                solicitud.estado = 'ANULADA'
                solicitud.save(update_fields=['estado'])

    except Exception as e:
        return JsonResponse({'error': f'Error al registrar la anulación: {e}'}, status=500)

    return JsonResponse({
        'ok':             True,
        'tipo':           tipo_anulacion,
        'dias_devueltos': float(dias_devolver),
    })
