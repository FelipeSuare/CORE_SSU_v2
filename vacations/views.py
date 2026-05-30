import json
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_POST

from core.models import Feriado
from employees.models import Funcionario, HistorialCargo
from accounts.models import FuncionarioRol
from vacations.models import (
    AprobacionSolicitud, GestionVacacion,
    JerarquiaAprobacion, SolicitudVacacion,
)

_NIVEL_LABELS = {
    'SUBORDINADO':            {1: 'Jefe de Área', 2: 'Gerente Adm./Salud', 3: 'Gerente General'},
    'JEFE_AREA':              {1: 'Gerente Adm./Salud', 2: 'Gerente General'},
    'DEPENDENCIA_DIRECTA':    {1: 'Gerente General'},
    'GERENTE_ADMINISTRATIVO': {1: 'Gerente General'},
    'GERENTE_SALUD':          {1: 'Gerente General'},
    'GERENTE_GENERAL':        {},
}

_ESTADOS_PENDIENTE = ('PENDIENTE_JEFE', 'PENDIENTE_GERENTE', 'PENDIENTE_GERENTE_GENERAL')


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
    anios = hoy.year - fi.year - ((hoy.month, hoy.day) < (fi.month, fi.day))
    puede_solicitar = anios >= 1 and saldos['dias_adeudados'] > 0

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
            solicitud = SolicitudVacacion.objects.create(
                cod_funcionario=f,
                fecha_salida=fecha_salida,
                fecha_retorno=fecha_retorno,
                dias_solicitados=dias,
                motivo_vacacion=motivo,
                estado='PENDIENTE_JEFE',
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
    try:
        f = _get_funcionario(request)
    except Funcionario.DoesNotExist:
        return JsonResponse({'error': 'Funcionario no encontrado.'}, status=404)

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
        resultado.append({
            'id': s.id_formulario,
            'codigo': f"G{s.id_formulario:03d}",
            'fecha_solicitud': s.fecha_solicitud.strftime('%Y-%m-%d'),
            'fecha_salida': s.fecha_salida.strftime('%Y-%m-%d'),
            'fecha_retorno': s.fecha_retorno.strftime('%Y-%m-%d'),
            'dias': float(s.dias_solicitados),
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

    hubo_rechazo = False
    for j in jerarquia:
        ap = aprobaciones.get(j.nivel_aprobacion)
        nombre_ap = (
            f"{j.cod_aprobador.ci.nombre} {j.cod_aprobador.ci.ap_paterno} "
            f"{j.cod_aprobador.ci.ap_materno or ''}"
        ).strip()
        label = labels.get(j.nivel_aprobacion, f'Nivel {j.nivel_aprobacion}')

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
_ESTADOS_MAPA_SIGUIENTE = {1: 'PENDIENTE_GERENTE', 2: 'PENDIENTE_GERENTE_GENERAL'}


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
            flujo.append({
                'nivel': j.nivel_aprobacion,
                'label': labels.get(j.nivel_aprobacion, f'Nivel {j.nivel_aprobacion}'),
                'nombre_aprobador': (
                    f"{j.cod_aprobador.ci.nombre} {j.cod_aprobador.ci.ap_paterno}"
                ).strip(),
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
