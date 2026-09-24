import calendar
import logging
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from io import BytesIO

logger = logging.getLogger(__name__)

from django.db import transaction
from django.db.models import Q, Sum
from django.http import HttpResponse
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import Feriado, UnidadOrganizacional
from core.api_permissions import NoCambioPendiente, EsRRHH, EsAprobador, EsFuncionarioActivo
from employees.models import Funcionario, HistorialCargo
from accounts.models import FuncionarioRol
from vacations.models import (
    AcuerdoVacacion, AcuerdoVacacionFuncionario,
    AnulacionAjuste, AprobacionSolicitud, GestionVacacion,
    JerarquiaAprobacion, SolicitudVacacion,
)
from vacations.utils import (
    calcular_anios_antiguedad,
    calcular_gestioneS_pendientes,
    dias_por_antiguedad,
    poblar_gestion_vacacion,
    aplicar_limite_gestiones_activas,
    anios_protegidos,
    devolver_dias,
    gestion_en_riesgo,
    gestiones_ocupadas,
    sumar_meses,
    DIAS_ANTICIPO_RECHAZO_PROTEGIDO,
    MESES_EXTENSION_RECHAZO,
    LIMITE_GESTIONES_ACTIVAS,
)

# ── Constantes ────────────────────────────────────────────────────────────────

_NIVEL_LABELS = {
    'PERSONAL DE AREA':      {1: 'Jefe de Área', 2: 'Gerente Adm./Salud', 3: 'Gerente General'},
    'JEFE AREA':             {1: 'Gerente Adm./Salud', 2: 'Gerente General'},
    'DEPENDENCIA DIRECTA':   {1: 'Gerente General'},
    'GERENTE ADMINISTRATIVO':{1: 'Gerente General'},
    'GERENTE SALUD':         {1: 'Gerente General'},
    'GERENTE GENERAL':       {},
}

_ESTADOS_PENDIENTE = ('PENDIENTE_JEFE', 'PENDIENTE_GERENTE_AREA', 'PENDIENTE_GERENTE_GENERAL')

# Niveles SEMÁNTICOS de la cadena de aprobación (independientes de la
# numeración que use `jerarquia_aprobacion`, que siempre arranca en 1):
#   1 = Jefe de Área   2 = Gerente Adm./Salud   3 = Gerente General
# Cada tipo de funcionario entra a la cadena en un punto distinto: un Jefe de
# Área salta el nivel 1, y gerentes/dependencia directa solo pasan por el 3.
_NIVELES_SEMANTICOS = {
    'PERSONAL DE AREA':       [1, 2, 3],
    'JEFE AREA':              [2, 3],
    'DEPENDENCIA DIRECTA':    [3],
    'GERENTE ADMINISTRATIVO': [3],
    'GERENTE SALUD':          [3],
    'GERENTE GENERAL':        [],
}

_NIVEL_SUBTITULO = {1: 'Jefe de Área', 2: 'Gte. Adm./Salud', 3: 'Gerente General'}

_ROLES_APROBADOR   = {'Jefe de Area', 'Gerente Administrativo', 'Gerente de Salud', 'Gerente General'}
_ESTADOS_SIGUIENTE = {1: 'PENDIENTE_GERENTE_AREA', 2: 'PENDIENTE_GERENTE_GENERAL'}
_ROLES_RRHH        = {'RRHH', 'Administrador'}

# ── Helpers internos ─────────────────────────────────────────────────────────

def _get_funcionario(request):
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


def _calcular_retorno(fecha_salida, dias_solicitados, feriados_set):
    dias_habiles       = Decimal('0')
    dias_fines_semana  = 0
    dias_feriados_count = 0
    target             = Decimal(str(dias_solicitados))
    fecha_actual       = fecha_salida

    while dias_habiles < target:
        dow = fecha_actual.weekday()

        if dow >= 5:
            dias_fines_semana += 1
            fecha_actual += timedelta(days=1)
            continue

        if fecha_actual in feriados_set:
            dias_feriados_count += 1
            fecha_actual += timedelta(days=1)
            continue

        dias_habiles += Decimal('1')
        fecha_actual += timedelta(days=1)

    return {
        'fecha_retorno':   fecha_actual,
        'dias_fines_semana': dias_fines_semana,
        'dias_feriados':   dias_feriados_count,
    }


def _siguiente_dia_habil(fecha, feriados_set):
    """Si `fecha` cae en fin de semana o feriado, avanza al próximo día hábil."""
    while fecha.weekday() >= 5 or fecha in feriados_set:
        fecha += timedelta(days=1)
    return fecha


def _get_usuario_rrhh(request):
    ci = request.user.username
    f = Funcionario.objects.select_related('ci').get(ci__ci=ci, estado='ACTIVO')
    roles = set(FuncionarioRol.objects.filter(
        cod_funcionario=f, activo=True
    ).values_list('id_roles__tipo_rol', flat=True))
    return f, roles


def _check_acceso_historial(request):
    ci = request.user.username
    try:
        f = Funcionario.objects.get(ci__ci=ci, estado='ACTIVO')
    except Funcionario.DoesNotExist:
        return False, None
    roles = set(FuncionarioRol.objects.filter(
        cod_funcionario=f, activo=True
    ).values_list('id_roles__tipo_rol', flat=True))
    return bool(roles & _ROLES_RRHH), f


def _sin_jefe_area(funcionario):
    """True si el funcionario es PERSONAL DE AREA y no tiene Jefe de Área activo en su jerarquía."""
    if funcionario.tipo_funcionario != 'PERSONAL DE AREA':
        return False
    return not JerarquiaAprobacion.objects.filter(
        cod_funcionario=funcionario,
        activo=True,
        cod_aprobador__tipo_funcionario='JEFE AREA',
    ).exists()


def _niveles_semanticos(tipo_funcionario):
    """Niveles semánticos por los que pasa una solicitud de ese tipo de funcionario."""
    return _NIVELES_SEMANTICOS.get(tipo_funcionario, _NIVELES_SEMANTICOS['PERSONAL DE AREA'])


def _nivel_cols(tipo_funcionario):
    """Columnas de nivel para 'Mis Solicitudes', una por nivel semántico."""
    return [
        {'nivel': n, 'header': f'Nivel {n}', 'subtitle': _NIVEL_SUBTITULO[n]}
        for n in _niveles_semanticos(tipo_funcionario)
    ]


def _nivel_labels_dinamico(funcionario):
    """Devuelve labels para las entradas de AprobacionSolicitud.
    Cuando sin_jefe_area=True, la BD tiene nivel 1=Gerente Adm/Salud y nivel 2=Gerente General
    (renumerados por redirigir_jerarquia_por_baja_jefe), por eso los labels se ajustan.
    """
    if _sin_jefe_area(funcionario):
        return {1: 'Gerente Adm./Salud', 2: 'Gerente General'}
    return _NIVEL_LABELS.get(funcionario.tipo_funcionario, {})


# ══════════════════════════════════════════════════════════════════════════════
#  MÓDULO: SOLICITUD DE VACACIONES
# ══════════════════════════════════════════════════════════════════════════════

class DatosFormularioView(APIView):
    permission_classes = [NoCambioPendiente, EsFuncionarioActivo]

    def get(self, request):
        try:
            f = _get_funcionario(request)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado o inactivo.'}, status=status.HTTP_404_NOT_FOUND)

        p        = f.ci
        cargo_act = HistorialCargo.objects.filter(cod_funcionario=f, es_actual=True).first()

        try:
            gv    = GestionVacacion.objects.get(cod_funcionario=f)
            saldos = _saldos_para_js(gv)
        except GestionVacacion.DoesNotExist:
            saldos = {'gestiones': [], 'dias_negados': 0.0, 'dias_adeudados': 0.0}

        jerarquia = [
            {
                'nivel': j.nivel_aprobacion,
                'cod':   j.cod_aprobador.cod_funcionario,
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

        hoy  = date.today()
        fi   = f.fecha_ingreso
        anios = calcular_anios_antiguedad(fi)
        puede_solicitar      = anios >= 1 and saldos['dias_adeudados'] > 0
        dias_correspondientes = float(dias_por_antiguedad(anios))
        gestiones_con_saldo  = sum(1 for g in saldos['gestiones'] if g['dias'] > 0)

        roles_activos = list(FuncionarioRol.objects.filter(
            cod_funcionario=f, activo=True
        ).values_list('id_roles__tipo_rol', flat=True))
        if 'Funcionario' not in roles_activos:
            roles_activos.insert(0, 'Funcionario')

        sin_jefe_area = False
        if f.tipo_funcionario == 'PERSONAL DE AREA':
            tiene_jefe = JerarquiaAprobacion.objects.filter(
                cod_funcionario=f, activo=True,
                cod_aprobador__tipo_funcionario='JEFE AREA',
            ).exists()
            sin_jefe_area = not tiene_jefe

        return Response({
            'cod_funcionario':      f.cod_funcionario,
            'nombre_completo':      f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip(),
            'ci':                   p.ci,
            'tipo_contrato':        cargo_act.tipo_contrato if cargo_act else '',
            'fecha_ingreso':        fi.strftime('%Y-%m-%d'),
            'fecha_nacimiento':     p.fecha_nacimiento.strftime('%Y-%m-%d') if p.fecha_nacimiento else '',
            'fecha_solicitud':      hoy.strftime('%Y-%m-%d'),
            'siguiente_codigo':     _preview_codigo(f),
            'saldos':               saldos,
            'jerarquia':            jerarquia,
            'puede_solicitar':      puede_solicitar,
            'tipo_funcionario':     f.tipo_funcionario,
            'gestiones_con_saldo':  gestiones_con_saldo,
            'roles':                roles_activos,
            'anios_antiguedad':     anios,
            'dias_correspondientes': dias_correspondientes,
            'sin_jefe_area':        sin_jefe_area,
        })


class CalcularRetornoView(APIView):
    permission_classes = [NoCambioPendiente, EsFuncionarioActivo]

    def post(self, request):
        fecha_salida_str = request.data.get('fecha_salida', '').strip()
        dias_str         = str(request.data.get('dias_solicitados', '')).strip()

        if not fecha_salida_str or not dias_str:
            return Response({'error': 'Datos incompletos.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            fecha_salida = date.fromisoformat(fecha_salida_str)
            dias         = Decimal(dias_str)
            if dias <= 0:
                raise ValueError
        except (ValueError, InvalidOperation):
            return Response(
                {'error': 'Valores de fecha o días inválidos.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        feriados_set = set(Feriado.objects.values_list('fecha', flat=True))
        result       = _calcular_retorno(fecha_salida, dias, feriados_set)

        fecha_retorno   = result['fecha_retorno']
        fecha_conclusion = fecha_retorno - timedelta(days=1)

        return Response({
            'fecha_retorno':    fecha_retorno.strftime('%Y-%m-%d'),
            'fecha_conclusion': fecha_conclusion.strftime('%Y-%m-%d'),
            'dias_fines_semana': result['dias_fines_semana'],
            'dias_feriados':    result['dias_feriados'],
            'dias_no_habiles':  result['dias_fines_semana'] + result['dias_feriados'],
            'dias_solicitados':  float(dias),
            'dias_efectivos':   float(dias),
        })


class CrearSolicitudView(APIView):
    permission_classes = [NoCambioPendiente, EsFuncionarioActivo]

    def post(self, request):
        fecha_salida_str  = request.data.get('fecha_salida', '').strip()
        fecha_retorno_str = request.data.get('fecha_retorno', '').strip()
        dias_str          = str(request.data.get('dias_solicitados', '')).strip()
        motivo            = request.data.get('motivo_vacacion', '').strip()

        if not all([fecha_salida_str, fecha_retorno_str, dias_str, motivo]):
            return Response({'error': 'Todos los campos son requeridos.'}, status=status.HTTP_400_BAD_REQUEST)

        if len(motivo) < 10:
            return Response(
                {'error': 'El motivo debe tener al menos 10 caracteres.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(motivo) > 500:
            return Response(
                {'error': 'El motivo no puede superar los 500 caracteres.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            fecha_salida  = date.fromisoformat(fecha_salida_str)
            fecha_retorno = date.fromisoformat(fecha_retorno_str)
            dias          = Decimal(dias_str)
            if dias <= 0 or (dias * 2) != int(dias * 2):
                raise ValueError
        except (ValueError, InvalidOperation):
            return Response(
                {'error': 'Valores de fecha o días inválidos.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            f = _get_funcionario(request)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado o inactivo.'}, status=status.HTTP_404_NOT_FOUND)

        if fecha_salida < f.fecha_ingreso:
            return Response(
                {'error': 'La fecha de salida no puede ser anterior a la fecha de ingreso del funcionario.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if fecha_salida < date.today():
            return Response(
                {'error': 'La fecha de salida no puede ser una fecha pasada.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            gv = GestionVacacion.objects.get(cod_funcionario=f)
        except GestionVacacion.DoesNotExist:
            return Response(
                {'error': 'No se encontró el registro de gestión de vacaciones.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        saldo_total = gv.dias_adeudados or Decimal('0')
        if dias > saldo_total:
            return Response(
                {'error': f'Saldo insuficiente. Disponible: {float(saldo_total)} días.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if SolicitudVacacion.objects.filter(
            cod_funcionario=f, estado__in=_ESTADOS_PENDIENTE
        ).exists():
            return Response(
                {'error': 'Ya tiene una solicitud de vacación pendiente de aprobación.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
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
                pendientes = dias
                orden = [slot for slot, _, _ in gestiones_ocupadas(gv)] + [
                    i for i in range(4, 0, -1) if getattr(gv, f'anio_gestion{i}') is None
                ]
                for i in orden:
                    if pendientes <= 0:
                        break
                    campo      = f'dias_gestion{i}'
                    disponible = getattr(gv, campo)
                    a_descontar = min(disponible, pendientes)
                    setattr(gv, campo, disponible - a_descontar)
                    pendientes -= a_descontar

                gv.save(update_fields=['dias_gestion1', 'dias_gestion2', 'dias_gestion3', 'dias_gestion4'])

        except Exception:
            logger.exception('Error al registrar solicitud de vacación para funcionario %s', f.cod_funcionario)
            return Response(
                {'error': 'Error al registrar la solicitud. Intente nuevamente.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({
            'ok': True,
            'id_formulario': solicitud.id_formulario,
            'codigo': f"G{solicitud.id_formulario:03d}",
        }, status=status.HTTP_201_CREATED)


class MisSolicitudesView(APIView):
    permission_classes = [NoCambioPendiente, EsFuncionarioActivo]

    def get(self, request):
        try:
            f = _get_funcionario(request)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        sin_niveles = not JerarquiaAprobacion.objects.filter(cod_funcionario=f, activo=True).exists()
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

        ajustes_parciales = {
            row['id_formulario']: float(row['total'])
            for row in AnulacionAjuste.objects.filter(
                id_formulario__in=ids, tipo_anulacion='AJUSTE',
            ).values('id_formulario').annotate(total=Sum('dias_devolver'))
        }

        # Estado actual de jerarquía (para solicitudes pendientes sin AprobacionSolicitud)
        sin_jefe_ahora = _sin_jefe_area(f)
        niveles_sem    = _niveles_semanticos(f.tipo_funcionario)

        def dato_nivel(aprs, nivel):
            ap = aprs.get(nivel)
            if not ap:
                return None
            return {
                'nombre':      f"{ap.cod_aprobador.ci.nombre} {ap.cod_aprobador.ci.ap_paterno}".strip(),
                'fecha':       ap.fecha_decision.strftime('%Y-%m-%d'),
                'decision':    ap.decision,
                'observacion': ap.observacion or '',
            }

        resultado = []
        for s in solicitudes_qs:
            aprs       = aprs_por_sol.get(s.id_formulario, {})
            todas_obs  = [ap.observacion for ap in aprs.values() if ap.observacion]
            dias_ajust = ajustes_parciales.get(s.id_formulario, 0.0)

            # La BD numera los niveles desde 1 para todos; el mapeo a nivel
            # semántico depende del tipo de funcionario (un Jefe de Área no
            # tiene nivel 1, un gerente solo tiene el 3).
            sem = niveles_sem
            if f.tipo_funcionario == 'PERSONAL DE AREA':
                # Sin Jefe de Área la BD queda renumerada (nivel 1 = Gte. Adm./Salud).
                # Si ya hay decisión en nivel 1, su aprobador dice cómo se procesó
                # ESTA solicitud; si sigue pendiente, vale el estado actual.
                ap1 = aprs.get(1)
                sol_sin_jefe = (
                    ap1.cod_aprobador.tipo_funcionario != 'JEFE AREA'
                    if ap1 is not None else sin_jefe_ahora
                )
                if sol_sin_jefe:
                    sem = sem[1:]

            niveles = {s: dato_nivel(aprs, db) for db, s in enumerate(sem, start=1)}

            resultado.append({
                'id':              s.id_formulario,
                'codigo':          f"G{s.id_formulario:03d}",
                'fecha_solicitud': s.fecha_solicitud.strftime('%Y-%m-%d'),
                'fecha_salida':    s.fecha_salida.strftime('%Y-%m-%d'),
                'fecha_retorno':   s.fecha_retorno.strftime('%Y-%m-%d'),
                'dias':            float(s.dias_solicitados) - dias_ajust,
                'motivo':          s.motivo_vacacion or '',
                'estado':          _estado_display(s.estado),
                'nivel1':          niveles.get(1),
                'nivel2':          niveles.get(2),
                'nivel3':          niveles.get(3),
                'observaciones':   todas_obs[-1] if todas_obs else None,
            })

        try:
            gv = GestionVacacion.objects.get(cod_funcionario=f)
            dias_adeudados = float(gv.dias_adeudados or 0)
        except GestionVacacion.DoesNotExist:
            dias_adeudados = 0.0

        dias_usados    = sum(r['dias'] for r in resultado if r['estado'] == 'Aprobada')
        dias_pendientes = sum(r['dias'] for r in resultado if r['estado'] == 'Pendiente')

        return Response({
            'solicitudes': resultado,
            'resumen': {
                'total':            len(resultado),
                'dias_usados':      dias_usados,
                'dias_pendientes':  dias_pendientes,
                'dias_adeudados':   dias_adeudados,
            },
            'funcionario': {
                'nombre': f"{f.ci.nombre} {f.ci.ap_paterno} {f.ci.ap_materno or ''}".strip(),
                'ci':     f.ci.ci,
            },
            'tipo_funcionario': f.tipo_funcionario,
            'nivel_cols':       _nivel_cols(f.tipo_funcionario),
        })


class SeguimientoSolicitudView(APIView):
    permission_classes = [NoCambioPendiente, EsFuncionarioActivo]

    def get(self, request):
        try:
            f = _get_funcionario(request)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        solicitud = (
            SolicitudVacacion.objects.filter(cod_funcionario=f)
            .order_by('-fecha_creacion')
            .first()
        )

        if not solicitud:
            return Response({'tiene_solicitud': False})

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

        labels   = _nivel_labels_dinamico(f)
        sin_jefe = _sin_jefe_area(f)

        timeline = [{
            'nivel':       'Funcionario',
            'responsable': f"{f.ci.nombre} {f.ci.ap_paterno}".strip(),
            'estado':      'sent',
            'fecha':       solicitud.fecha_solicitud.strftime('%Y-%m-%d'),
            'comentarios': solicitud.motivo_vacacion or 'Solicitud enviada a revisión',
        }]

        # Entrada sintética para Jefe de Área ausente — preserva el registro histórico
        if sin_jefe and jerarquia:
            timeline.append({
                'nivel':       'Jefe de Área',
                'responsable': 'No asignado',
                'estado':      'na',
                'fecha':       None,
                'comentarios': 'Sin Jefe de Área asignado al momento de esta solicitud.',
            })

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

            if ap:
                dec = ap.cod_aprobador.ci
                nombre_ap = f"{dec.nombre} {dec.ap_paterno} {dec.ap_materno or ''}".strip()
            else:
                cur = j.cod_aprobador.ci
                nombre_ap = f"{cur.nombre} {cur.ap_paterno} {cur.ap_materno or ''}".strip()

            if hubo_rechazo:
                timeline.append({'nivel': label, 'responsable': nombre_ap,
                                  'estado': 'inactive', 'fecha': None, 'comentarios': None})
                continue

            if ap:
                es_rechazo = ap.decision.upper() == 'RECHAZADO'
                if es_rechazo:
                    hubo_rechazo = True
                timeline.append({
                    'nivel':       label,
                    'responsable': nombre_ap,
                    'estado':      'rejected' if es_rechazo else 'approved',
                    'fecha':       ap.fecha_decision.strftime('%Y-%m-%d'),
                    'comentarios': ap.observacion or '',
                })
            else:
                timeline.append({
                    'nivel': label, 'responsable': nombre_ap,
                    'estado': 'pending', 'fecha': None, 'comentarios': None,
                })

        return Response({
            'tiene_solicitud': True,
            'id':     solicitud.id_formulario,
            'codigo': f"G{solicitud.id_formulario:03d}",
            'estado': _estado_display(solicitud.estado),
            'timeline': timeline,
        })


# ══════════════════════════════════════════════════════════════════════════════
#  MÓDULO: APROBACIÓN Y/O RECHAZO
# ══════════════════════════════════════════════════════════════════════════════

class SolicitudesParaAprobarView(APIView):
    permission_classes = [NoCambioPendiente, EsAprobador]

    def get(self, request):
        try:
            aprobador = _get_funcionario(request)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        roles = set(FuncionarioRol.objects.filter(
            cod_funcionario=aprobador, activo=True
        ).values_list('id_roles__tipo_rol', flat=True))

        es_admin            = 'Administrador' in roles
        tiene_rol_aprobador = bool(roles & _ROLES_APROBADOR)

        if not es_admin and not tiene_rol_aprobador:
            return Response({'error': 'Sin permiso de aprobación.'}, status=status.HTTP_403_FORBIDDEN)

        rol_display = next(
            (r for r in [
                'Gerente General', 'Gerente Administrativo', 'Gerente de Salud',
                'Jefe de Area', 'Administrador',
            ] if r in roles),
            'Aprobador'
        )

        if tiene_rol_aprobador:
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
            return Response({
                'aprobador': {
                    'nombre': f"{aprobador.ci.nombre} {aprobador.ci.ap_paterno}".strip(),
                    'rol':    rol_display,
                    'cod':    aprobador.cod_funcionario,
                    'roles':  roles_lista,
                },
                'puede_aprobar': tiene_rol_aprobador,
                'solicitudes':   [],
                'contadores':    {'pendientes': 0, 'aprobadas': 0},
            })

        sol_ids       = [s.id_formulario for s in solicitudes_qs]
        cod_funcs_sol = list({s.cod_funcionario_id for s in solicitudes_qs})

        aprobaciones_por_sol = {}
        for ap in AprobacionSolicitud.objects.filter(
            id_formulario__in=sol_ids
        ).select_related('cod_aprobador__ci'):
            aprobaciones_por_sol.setdefault(ap.id_formulario_id, {})[ap.nivel] = ap

        cargos = {
            h.cod_funcionario_id: h
            for h in HistorialCargo.objects.filter(cod_funcionario__in=cod_funcs_sol, es_actual=True)
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
            f        = sol.cod_funcionario
            p        = f.ci
            cargo_act = cargos.get(f.cod_funcionario)
            gv        = gestiones.get(f.cod_funcionario)
            aprs      = aprobaciones_por_sol.get(sol.id_formulario, {})
            mi_nivel  = mi_nivel_por_func.get(f.cod_funcionario)

            if mi_nivel is not None and sol.estado not in ('APROBADA', 'RECHAZADA'):
                prev_ok     = all(
                    aprs.get(n) and aprs[n].decision.upper() == 'APROBADO'
                    for n in range(1, mi_nivel)
                )
                puede_actuar = prev_ok and (mi_nivel not in aprs)
            else:
                puede_actuar = False

            labels = _nivel_labels_dinamico(f)
            flujo  = []
            for j in jerarquias_por_func.get(f.cod_funcionario, []):
                ap = aprs.get(j.nivel_aprobacion)
                if ap:
                    dec = ap.cod_aprobador.ci
                    nombre_apr = f"{dec.nombre} {dec.ap_paterno}".strip()
                else:
                    nombre_apr = f"{j.cod_aprobador.ci.nombre} {j.cod_aprobador.ci.ap_paterno}".strip()
                flujo.append({
                    'nivel':            j.nivel_aprobacion,
                    'label':            labels.get(j.nivel_aprobacion, f'Nivel {j.nivel_aprobacion}'),
                    'nombre_aprobador': nombre_apr,
                    'decision':         ap.decision if ap else None,
                    'fecha':            ap.fecha_decision.strftime('%Y-%m-%d') if ap else None,
                    'observacion':      ap.observacion if ap else None,
                    'es_mi_nivel':      j.nivel_aprobacion == mi_nivel,
                })

            dias_adeudados_actual = float(gv.dias_adeudados or 0) if gv else 0
            saldo_antes   = round(dias_adeudados_actual + float(sol.dias_solicitados), 1)
            saldo_despues = round(dias_adeudados_actual, 1)

            resultado.append({
                'id':              sol.id_formulario,
                'codigo':          f"G{sol.id_formulario:03d}",
                'cod_funcionario': f.cod_funcionario,
                'funcionario':     f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip(),
                'cargo':           cargo_act.cargo if cargo_act else '',
                'tipo_contrato':   cargo_act.tipo_contrato if cargo_act else '',
                'unidad':          f.id_unidad.nombre if f.id_unidad else '',
                'fecha_solicitud': sol.fecha_solicitud.strftime('%Y-%m-%d'),
                'fecha_salida':    sol.fecha_salida.strftime('%Y-%m-%d'),
                'fecha_retorno':   sol.fecha_retorno.strftime('%Y-%m-%d'),
                'dias':            float(sol.dias_solicitados),
                'motivo':          sol.motivo_vacacion or '',
                'estado_db':       sol.estado,
                'estado_display':  _estado_display(sol.estado),
                'saldo_antes':     saldo_antes,
                'saldo_despues':   saldo_despues,
                'mi_nivel':        mi_nivel,
                'puede_actuar':    puede_actuar,
                'flujo':           flujo,
            })

        # Para aprobadores con rol definido, filtrar: solo las que requieren su acción
        # o en las que ya emitieron su decisión (historial propio). Los admins ven todo.
        if tiene_rol_aprobador:
            sol_ids_con_mi_decision = {
                sol_id
                for sol_id, aprs in aprobaciones_por_sol.items()
                if any(
                    ap.cod_aprobador_id == aprobador.cod_funcionario
                    for ap in aprs.values()
                )
            }
            resultado = [
                r for r in resultado
                if r['puede_actuar'] or r['id'] in sol_ids_con_mi_decision
            ]

        pendientes_count = sum(1 for r in resultado if r['puede_actuar'])
        aprobadas_count  = sum(1 for r in resultado if r['estado_db'] == 'APROBADA')

        return Response({
            'aprobador': {
                'nombre': f"{aprobador.ci.nombre} {aprobador.ci.ap_paterno}".strip(),
                'rol':    rol_display,
                'cod':    aprobador.cod_funcionario,
                'roles':  roles_lista,
            },
            'puede_aprobar': tiene_rol_aprobador,
            'solicitudes':   resultado,
            'contadores':    {'pendientes': pendientes_count, 'aprobadas': aprobadas_count},
        })


def _proteger_si_rechazo_cerca_de_vencer(solicitud, gv, aprobador, observacion):
    """
    Si la solicitud rechazada se pidió dentro de DIAS_ANTICIPO_RECHAZO_PROTEGIDO
    días antes de la fecha límite de la gestión en riesgo, crea un
    AcuerdoVacacion tipo RECHAZO que la protege hasta fecha límite +
    MESES_EXTENSION_RECHAZO: el funcionario intentó tomarla a tiempo.
    Retorna el acuerdo creado o None.
    """
    solicitante = solicitud.cod_funcionario
    protegidos  = anios_protegidos(solicitante.cod_funcionario)
    riesgo      = gestion_en_riesgo(gv, solicitante.fecha_ingreso, protegidos)
    if not riesgo:
        return None
    _, anio, _, fecha_limite = riesgo
    if not 0 <= (fecha_limite - solicitud.fecha_solicitud).days <= DIAS_ANTICIPO_RECHAZO_PROTEGIDO:
        return None

    acuerdo = AcuerdoVacacion.objects.create(
        tipo='RECHAZO',
        motivo=f'Solicitud G{solicitud.id_formulario:03d} rechazada cerca del vencimiento: {observacion}',
        fecha_acuerdo=date.today(),
        fecha_hasta=sumar_meses(fecha_limite, MESES_EXTENSION_RECHAZO),
        id_formulario=solicitud,
        registrado_por=aprobador,
    )
    AcuerdoVacacionFuncionario.objects.create(
        id_acuerdo=acuerdo, cod_funcionario=solicitante, anio_gestion=anio,
    )
    return acuerdo


class RegistrarDecisionView(APIView):
    permission_classes = [NoCambioPendiente, EsAprobador]

    def post(self, request):
        try:
            id_formulario = int(request.data.get('id_formulario'))
        except (TypeError, ValueError):
            return Response({'error': 'id_formulario inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        decision      = str(request.data.get('decision', '')).upper().strip()
        observacion   = request.data.get('observacion', '').strip()

        if not id_formulario or decision not in ('APROBADO', 'RECHAZADO'):
            return Response({'error': 'Datos inválidos.'}, status=status.HTTP_400_BAD_REQUEST)

        if decision == 'RECHAZADO' and len(observacion) < 10:
            return Response(
                {'error': 'Para rechazar debe ingresar un motivo (mínimo 10 caracteres).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            aprobador = _get_funcionario(request)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Aprobador no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            solicitud = SolicitudVacacion.objects.select_related('cod_funcionario__ci').get(
                id_formulario=id_formulario
            )
        except SolicitudVacacion.DoesNotExist:
            return Response({'error': 'Solicitud no encontrada.'}, status=status.HTTP_404_NOT_FOUND)

        if solicitud.estado in ('APROBADA', 'RECHAZADA'):
            return Response({'error': 'Esta solicitud ya fue procesada.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            jerarquia = JerarquiaAprobacion.objects.get(
                cod_funcionario=solicitud.cod_funcionario,
                cod_aprobador=aprobador,
                activo=True,
            )
        except JerarquiaAprobacion.DoesNotExist:
            return Response(
                {'error': 'No tiene autoridad para aprobar esta solicitud.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        mi_nivel = jerarquia.nivel_aprobacion
        aprs     = {
            ap.nivel: ap
            for ap in AprobacionSolicitud.objects.filter(id_formulario=solicitud)
        }

        for n in range(1, mi_nivel):
            if not aprs.get(n) or aprs[n].decision.upper() != 'APROBADO':
                return Response(
                    {'error': f'El nivel {n} aún no ha aprobado la solicitud.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if mi_nivel in aprs:
            return Response(
                {'error': 'Ya emitió su decisión sobre esta solicitud.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
                    gv = GestionVacacion.objects.select_for_update().filter(
                        cod_funcionario=solicitante
                    ).first()
                    if gv:
                        devolver_dias(gv, solicitud.dias_solicitados)
                        gv.dias_negados = (gv.dias_negados or Decimal('0')) + solicitud.dias_solicitados
                        gv.save(update_fields=[
                            'dias_gestion1', 'dias_gestion2', 'dias_gestion3', 'dias_gestion4',
                            'dias_negados',
                        ])
                        _proteger_si_rechazo_cerca_de_vencer(solicitud, gv, aprobador, observacion)
                else:
                    total_niveles = JerarquiaAprobacion.objects.filter(
                        cod_funcionario=solicitante, activo=True
                    ).count()
                    if mi_nivel >= total_niveles:
                        solicitud.estado = 'APROBADA'
                    else:
                        solicitud.estado = _ESTADOS_SIGUIENTE.get(
                            mi_nivel, 'PENDIENTE_GERENTE_GENERAL'
                        )
                    solicitud.save(update_fields=['estado'])

        except Exception:
            logger.exception('Error al registrar decisión de solicitud #%s', id_formulario)
            return Response(
                {'error': 'Error al procesar la decisión. Intente nuevamente.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({
            'ok':           True,
            'decision':     decision,
            'nuevo_estado': _estado_display(solicitud.estado),
            'codigo':       f"G{solicitud.id_formulario:03d}",
        })


# ══════════════════════════════════════════════════════════════════════════════
#  MÓDULO: GESTIÓN DE SALDO (RRHH)
# ══════════════════════════════════════════════════════════════════════════════

class AcreditarGestionView(APIView):
    permission_classes = [NoCambioPendiente, EsRRHH]

    def post(self, request):
        try:
            _, roles = _get_usuario_rrhh(request)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        if not (roles & _ROLES_RRHH):
            return Response(
                {'error': 'Sin permiso. Se requiere rol RRHH o Administrador.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        cod_funcionario = str(request.data.get('cod_funcionario', '')).strip()
        anio_raw        = request.data.get('anio_gestion')

        if not cod_funcionario or anio_raw is None:
            return Response(
                {'error': 'cod_funcionario y anio_gestion son requeridos.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            anio_gestion = int(anio_raw)
            if anio_gestion < 2000 or anio_gestion > date.today().year:
                raise ValueError
        except (ValueError, TypeError):
            return Response({'error': 'anio_gestion inválido.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            funcionario = Funcionario.objects.select_related('ci').get(cod_funcionario=cod_funcionario)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        referencia = date(anio_gestion, 12, 31)
        anios      = calcular_anios_antiguedad(funcionario.fecha_ingreso, referencia)

        if anios < 1:
            return Response(
                {'error': f'El funcionario no completó 1 año de servicio en la gestión {anio_gestion}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        dias = dias_por_antiguedad(anios)

        with transaction.atomic():
            try:
                gv = GestionVacacion.objects.select_for_update().get(cod_funcionario=funcionario)
            except GestionVacacion.DoesNotExist:
                gv = GestionVacacion(cod_funcionario=funcionario)

            for i in range(1, 5):
                if getattr(gv, f'anio_gestion{i}') == anio_gestion:
                    return Response(
                        {'error': f'La gestión {anio_gestion} ya fue acreditada para este funcionario.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            slot = next((i for i in range(4, 0, -1) if getattr(gv, f'anio_gestion{i}') is None), None)

            evictadas = []
            if slot is None:
                # Datos legado: los 4 slots físicos ya están ocupados (aún no se
                # corrió la migración de datos a 2 gestiones activas). Se libera
                # espacio evictando la(s) más antigua(s) antes de insertar.
                evictadas += aplicar_limite_gestiones_activas(gv, limite=LIMITE_GESTIONES_ACTIVAS - 1)
                slot = next((i for i in range(4, 0, -1) if getattr(gv, f'anio_gestion{i}') is None), None)

            if slot is None:
                return Response(
                    {'error': 'No se pudo asignar un slot libre. Contacte soporte.'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

            setattr(gv, f'anio_gestion{slot}', anio_gestion)
            setattr(gv, f'dias_gestion{slot}', dias)

            # Tope normal: ya con la gestión nueva insertada, recorta a 2 activas.
            evictadas += aplicar_limite_gestiones_activas(gv)

            campos = {f'anio_gestion{slot}', f'dias_gestion{slot}'}
            if evictadas:
                campos.add('dias_perdidos')
                for ev in evictadas:
                    campos.add(f"anio_gestion{ev['slot']}")
                    campos.add(f"dias_gestion{ev['slot']}")

            if gv.pk:
                gv.save(update_fields=list(campos))
            else:
                gv.save()

        p = funcionario.ci
        return Response({
            'ok':               True,
            'funcionario':      f"{p.nombre} {p.ap_paterno}".strip(),
            'anio_gestion':     anio_gestion,
            'anios_antiguedad': anios,
            'dias_acreditados': float(dias),
            'slot':             slot,
            'gestiones_perdidas': [
                {'anio': ev['anio'], 'dias': float(ev['dias'])} for ev in evictadas
            ],
        }, status=status.HTTP_201_CREATED)


class InicializarVacacionesView(APIView):
    permission_classes = [NoCambioPendiente, EsRRHH]

    def post(self, request):
        try:
            _, roles = _get_usuario_rrhh(request)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        if not (roles & _ROLES_RRHH):
            return Response(
                {'error': 'Sin permiso. Se requiere rol RRHH o Administrador.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        cod_funcionario = str(request.data.get('cod_funcionario', '')).strip()

        qs = Funcionario.objects.select_related('ci').filter(estado='ACTIVO')
        if cod_funcionario:
            qs = qs.filter(cod_funcionario=cod_funcionario)
            if not qs.exists():
                return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        procesados = []
        omitidos   = []

        for f in qs:
            stats  = poblar_gestion_vacacion(f)
            nombre = f"{f.ci.nombre} {f.ci.ap_paterno}".strip()
            if stats['sin_elegibilidad']:
                omitidos.append({'cod': f.cod_funcionario, 'nombre': nombre, 'motivo': 'Sin antigüedad suficiente'})
            elif stats['acreditadas'] == 0:
                omitidos.append({'cod': f.cod_funcionario, 'nombre': nombre, 'motivo': 'Gestiones ya acreditadas'})
            else:
                procesados.append({
                    'cod':                 f.cod_funcionario,
                    'nombre':              nombre,
                    'gestiones_acreditadas': stats['acreditadas'],
                })

        return Response({
            'ok':        True,
            'procesados': procesados,
            'omitidos':   omitidos,
            'resumen': {
                'total_procesados': len(procesados),
                'total_omitidos':   len(omitidos),
            },
        })


# ══════════════════════════════════════════════════════════════════════════════
#  MÓDULO: HISTORIAL DE SOLICITUDES (RRHH)
# ══════════════════════════════════════════════════════════════════════════════

class HistorialRRHHView(APIView):
    permission_classes = [NoCambioPendiente, EsRRHH]

    def get(self, request):
        tiene_acceso, f_user = _check_acceso_historial(request)
        if not tiene_acceso:
            return Response({'error': 'Sin acceso.'}, status=status.HTTP_403_FORBIDDEN)

        unidad_id = request.GET.get('unidad', '').strip()
        tipo_cont = request.GET.get('tipo_contrato', '').strip()
        nombre_b  = request.GET.get('funcionario', '').strip()

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
        ajustes_parciales = {
            row['id_formulario']: float(row['total'])
            for row in AnulacionAjuste.objects.filter(
                id_formulario__in=sol_ids, tipo_anulacion='AJUSTE',
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
            f              = sol.cod_funcionario
            p              = f.ci
            cargo_act      = cargos.get(f.cod_funcionario)
            gv             = gestiones.get(f.cod_funcionario)
            dias_ajustados = ajustes_parciales.get(sol.id_formulario, 0.0)
            resultado.append({
                'id':             sol.id_formulario,
                'codigo':         f"G{sol.id_formulario:03d}",
                'funcionario':    f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip(),
                'cargo':          cargo_act.cargo if cargo_act else '—',
                'tipo_contrato':  cargo_act.tipo_contrato if cargo_act else '—',
                'unidad':         f.id_unidad.nombre if f.id_unidad else '—',
                'fecha_solicitud': sol.fecha_solicitud.strftime('%Y-%m-%d'),
                'fecha_salida':   sol.fecha_salida.strftime('%Y-%m-%d'),
                'fecha_retorno':  sol.fecha_retorno.strftime('%Y-%m-%d'),
                'dias':           float(sol.dias_solicitados) - dias_ajustados,
                'dias_adeudados': float(gv.dias_adeudados or 0) if gv else 0.0,
            })

        roles_activos = list(FuncionarioRol.objects.filter(
            cod_funcionario=f_user, activo=True
        ).values_list('id_roles__tipo_rol', flat=True))
        if 'Funcionario' not in roles_activos:
            roles_activos.insert(0, 'Funcionario')

        return Response({
            'solicitudes': resultado,
            'filtros': {
                'unidades':       unidades,
                'tipos_contrato': tipos_contrato,
            },
            'usuario': {
                'nombre': f"{f_user.ci.nombre} {f_user.ci.ap_paterno}".strip(),
                'roles':  roles_activos,
            },
        })


class DescargarPDFView(APIView):
    permission_classes = [NoCambioPendiente, EsRRHH]

    def get(self, request, id_formulario):
        tiene_acceso, _ = _check_acceso_historial(request)
        if not tiene_acceso:
            return Response({'error': 'Sin acceso.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            solicitud = SolicitudVacacion.objects.select_related(
                'cod_funcionario__ci', 'cod_funcionario__id_unidad'
            ).get(id_formulario=id_formulario, estado='APROBADA')
        except SolicitudVacacion.DoesNotExist:
            return Response(
                {'error': 'Solicitud aprobada no encontrada.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            from vacations.views import _generar_pdf_solicitud
            pdf_bytes = _generar_pdf_solicitud(solicitud)
        except Exception:
            logger.exception('Error generando PDF de solicitud #%s', id_formulario)
            return Response(
                {'error': 'Error al generar el PDF. Por favor intente nuevamente.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        cod      = f"G{solicitud.id_formulario:03d}"
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="Vacacion_{cod}.pdf"'
        return response


# ══════════════════════════════════════════════════════════════════════════════
#  MÓDULO: ANULACIÓN Y AJUSTE (RRHH)
# ══════════════════════════════════════════════════════════════════════════════

class SolicitudesAnulacionView(APIView):
    permission_classes = [NoCambioPendiente, EsRRHH]

    def get(self, request):
        tiene_acceso, f_user = _check_acceso_historial(request)
        if not tiene_acceso:
            return Response({'error': 'Sin acceso.'}, status=status.HTTP_403_FORBIDDEN)

        qs = (
            SolicitudVacacion.objects
            .filter(estado__in=('APROBADA', 'ANULADA'), fecha_retorno__gte=date.today())
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
        ajustes_parciales = {
            row['id_formulario']: float(row['total'])
            for row in AnulacionAjuste.objects.filter(
                id_formulario__in=sol_ids, tipo_anulacion='AJUSTE',
            ).values('id_formulario').annotate(total=Sum('dias_devolver'))
        }

        roles_activos = list(FuncionarioRol.objects.filter(
            cod_funcionario=f_user, activo=True
        ).values_list('id_roles__tipo_rol', flat=True))
        if 'Funcionario' not in roles_activos:
            roles_activos.insert(0, 'Funcionario')

        resultado = []
        for sol in sol_list:
            f              = sol.cod_funcionario
            p              = f.ci
            cargo_act      = cargos.get(f.cod_funcionario)
            gv             = gestiones.get(f.cod_funcionario)
            dias_ajustados = ajustes_parciales.get(sol.id_formulario, 0.0)
            resultado.append({
                'id':          sol.id_formulario,
                'codigo':      f"G{sol.id_formulario:03d}",
                'funcionario': f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip(),
                'cargo':       cargo_act.cargo if cargo_act else '—',
                'fechaInicio': sol.fecha_salida.strftime('%Y-%m-%d'),
                'fechaFinal':  sol.fecha_retorno.strftime('%Y-%m-%d'),
                'diasTotales': float(sol.dias_solicitados) - dias_ajustados,
                'estado':      'anulada' if sol.estado == 'ANULADA' else 'activa',
                'saldoActual': float(gv.dias_adeudados or 0) if gv else 0.0,
            })

        return Response({
            'solicitudes': resultado,
            'usuario': {
                'nombre': f"{f_user.ci.nombre} {f_user.ci.ap_paterno}".strip(),
                'roles':  roles_activos,
            },
        })


class RegistrarAnulacionView(APIView):
    permission_classes = [NoCambioPendiente, EsRRHH]

    def post(self, request):
        tiene_acceso, f_rrhh = _check_acceso_historial(request)
        if not tiene_acceso:
            return Response({'error': 'Sin acceso.'}, status=status.HTTP_403_FORBIDDEN)

        id_formulario    = request.data.get('id_formulario')
        tipo_anulacion   = str(request.data.get('tipo_anulacion', '')).strip().lower()
        motivo_anulacion = request.data.get('motivo_anulacion', '').strip()
        observaciones    = request.data.get('observaciones', '').strip()
        dias_devolver_raw = request.data.get('dias_devolver')

        if not id_formulario or tipo_anulacion not in ('total', 'parcial'):
            return Response({'error': 'Datos inválidos.'}, status=status.HTTP_400_BAD_REQUEST)
        if not motivo_anulacion:
            return Response({'error': 'El motivo es requerido.'}, status=status.HTTP_400_BAD_REQUEST)
        if not observaciones or len(observaciones) < 20:
            return Response(
                {'error': 'Las observaciones deben tener al menos 20 caracteres.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(observaciones) > 1000 or len(motivo_anulacion) > 500:
            return Response(
                {'error': 'El texto supera la longitud máxima permitida.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            solicitud = SolicitudVacacion.objects.select_related(
                'cod_funcionario'
            ).get(id_formulario=id_formulario, estado='APROBADA')
        except SolicitudVacacion.DoesNotExist:
            return Response(
                {'error': 'Solicitud no encontrada o ya fue procesada.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        ya_ajustados   = AnulacionAjuste.objects.filter(
            id_formulario=solicitud, tipo_anulacion='AJUSTE'
        ).aggregate(total=Sum('dias_devolver'))['total'] or Decimal('0')
        dias_efectivos = solicitud.dias_solicitados - ya_ajustados

        if tipo_anulacion == 'total':
            dias_devolver = dias_efectivos
        else:
            try:
                dias_devolver = Decimal(str(dias_devolver_raw))
                if dias_devolver <= 0 or dias_devolver > dias_efectivos:
                    raise ValueError
            except (TypeError, ValueError, InvalidOperation):
                return Response(
                    {'error': f'Días a devolver inválidos. Máximo disponible: {float(dias_efectivos)}.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        f = solicitud.cod_funcionario
        try:
            gv = GestionVacacion.objects.get(cod_funcionario=f)
        except GestionVacacion.DoesNotExist:
            return Response(
                {'error': 'Sin registro de gestión para este funcionario.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

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

                devolver_dias(gv, dias_devolver)
                gv.save(update_fields=[
                    'dias_gestion1', 'dias_gestion2', 'dias_gestion3', 'dias_gestion4'
                ])

                if tipo_anulacion == 'total':
                    solicitud.estado = 'ANULADA'
                    solicitud.save(update_fields=['estado'])

        except Exception:
            logger.exception('Error al registrar anulación/ajuste de solicitud #%s', id_formulario)
            return Response(
                {'error': 'Error al registrar la anulación. Intente nuevamente.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({
            'ok':             True,
            'tipo':           tipo_anulacion,
            'dias_devueltos': float(dias_devolver),
        })


# ══════════════════════════════════════════════════════════════════════════════
#  MÓDULO: SOLICITUDES RECHAZADAS (RRHH)
# ══════════════════════════════════════════════════════════════════════════════

class SolicitudesRechazadasView(APIView):
    permission_classes = [NoCambioPendiente, EsRRHH]

    def get(self, request):
        tiene_acceso, f_user = _check_acceso_historial(request)
        if not tiene_acceso:
            return Response({'error': 'Sin acceso.'}, status=status.HTTP_403_FORBIDDEN)

        unidad_id = request.GET.get('unidad', '').strip()
        nombre_b  = request.GET.get('funcionario', '').strip()

        qs = SolicitudVacacion.objects.filter(estado='RECHAZADA').select_related(
            'cod_funcionario__ci', 'cod_funcionario__id_unidad'
        ).order_by('-fecha_solicitud')

        if unidad_id:
            qs = qs.filter(cod_funcionario__id_unidad=unidad_id)
        if nombre_b:
            qs = qs.filter(
                Q(cod_funcionario__ci__nombre__icontains=nombre_b) |
                Q(cod_funcionario__ci__ap_paterno__icontains=nombre_b)
            )

        sol_list  = list(qs)
        sol_ids   = [s.id_formulario for s in sol_list]
        cod_funcs = list({s.cod_funcionario_id for s in sol_list})

        cargos = {
            h.cod_funcionario_id: h
            for h in HistorialCargo.objects.filter(cod_funcionario__in=cod_funcs, es_actual=True)
        }

        aprobaciones_por_sol = {}
        for ap in AprobacionSolicitud.objects.filter(
            id_formulario__in=sol_ids
        ).select_related('cod_aprobador__ci').order_by('nivel'):
            aprobaciones_por_sol.setdefault(ap.id_formulario_id, {})[ap.nivel] = ap

        unidades = list(
            UnidadOrganizacional.objects.filter(activo=True)
            .values('id_unidad', 'nombre').order_by('nombre')
        )

        roles_activos = list(FuncionarioRol.objects.filter(
            cod_funcionario=f_user, activo=True
        ).values_list('id_roles__tipo_rol', flat=True))
        if 'Funcionario' not in roles_activos:
            roles_activos.insert(0, 'Funcionario')

        resultado = []
        for sol in sol_list:
            f         = sol.cod_funcionario
            p         = f.ci
            cargo_act = cargos.get(f.cod_funcionario)
            aprs      = aprobaciones_por_sol.get(sol.id_formulario, {})

            apr_rechazo = next(
                (ap for ap in aprs.values() if ap.decision.upper() == 'RECHAZADO'),
                None,
            )
            labels = _NIVEL_LABELS.get(f.tipo_funcionario, {})

            resultado.append({
                'id':              sol.id_formulario,
                'codigo':          f"G{sol.id_formulario:03d}",
                'funcionario':     f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip(),
                'cargo':           cargo_act.cargo if cargo_act else '—',
                'tipo_contrato':   cargo_act.tipo_contrato if cargo_act else '—',
                'unidad':          f.id_unidad.nombre if f.id_unidad else '—',
                'fecha_solicitud': sol.fecha_solicitud.strftime('%Y-%m-%d'),
                'fecha_salida':    sol.fecha_salida.strftime('%Y-%m-%d'),
                'fecha_retorno':   sol.fecha_retorno.strftime('%Y-%m-%d'),
                'dias':            float(sol.dias_solicitados),
                'nivel_rechazo':   apr_rechazo.nivel if apr_rechazo else None,
                'label_rechazo':   labels.get(apr_rechazo.nivel, f'Nivel {apr_rechazo.nivel}') if apr_rechazo else '—',
                'aprobador_rechazo': (
                    f"{apr_rechazo.cod_aprobador.ci.nombre} {apr_rechazo.cod_aprobador.ci.ap_paterno}".strip()
                    if apr_rechazo else '—'
                ),
                'observacion':     apr_rechazo.observacion if apr_rechazo else '—',
                'fecha_rechazo':   apr_rechazo.fecha_decision.strftime('%Y-%m-%d') if apr_rechazo else None,
            })

        return Response({
            'solicitudes': resultado,
            'filtros':     {'unidades': unidades},
            'usuario': {
                'nombre': f"{f_user.ci.nombre} {f_user.ci.ap_paterno}".strip(),
                'roles':  roles_activos,
            },
        })


class DescargarPDFRechazadaView(APIView):
    permission_classes = [NoCambioPendiente, EsRRHH]

    def get(self, request, id_formulario):
        tiene_acceso, _ = _check_acceso_historial(request)
        if not tiene_acceso:
            return Response({'error': 'Sin acceso.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            solicitud = SolicitudVacacion.objects.select_related(
                'cod_funcionario__ci', 'cod_funcionario__id_unidad'
            ).get(id_formulario=id_formulario, estado='RECHAZADA')
        except SolicitudVacacion.DoesNotExist:
            return Response(
                {'error': 'Solicitud rechazada no encontrada.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        apr_rechazo = (
            AprobacionSolicitud.objects
            .filter(id_formulario=solicitud, decision__iexact='RECHAZADO')
            .select_related('cod_aprobador__ci')
            .first()
        )

        try:
            from vacations.views import _generar_pdf_rechazada
            pdf_bytes = _generar_pdf_rechazada(solicitud, apr_rechazo)
        except Exception:
            logger.exception('Error generando PDF rechazada #%s', id_formulario)
            return Response(
                {'error': 'Error al generar el PDF. Por favor intente nuevamente.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        cod      = f"G{solicitud.id_formulario:03d}"
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="Rechazada_{cod}.pdf"'
        return response


# ══════════════════════════════════════════════════════════════════════════════
#  ALERTA: funcionarios a punto de perder días (3ra gestión sin solicitar)
# ══════════════════════════════════════════════════════════════════════════════

_ANTICIPO_RIESGO_MESES = 1


def _sumar_meses(fecha, meses):
    """Suma N meses a una fecha controlando límite de día del mes."""
    mes_total = fecha.month - 1 + meses
    anio = fecha.year + mes_total // 12
    mes = mes_total % 12 + 1
    dia = min(fecha.day, [31, 29 if anio % 4 == 0 and (anio % 100 != 0 or anio % 400 == 0) else 28,
                          31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1])
    return date(anio, mes, dia)


def _calcular_alertas_gestiones_vencidas(funcionarios, hoy=None):
    """
    Funcionarios (de la lista/queryset dada) que ya tienen sus 2 gestiones
    activas ocupadas (tope actual) y además ya son elegibles -o lo serán
    dentro de _ANTICIPO_RIESGO_MESES, según su antigüedad- para una gestión
    adicional que todavía no fue acreditada. La próxima acreditación
    (automática vía 'poblar_vacaciones' o manual por RRHH) evictará su
    gestión más antigua a días perdidos.

    Compartida por AlertaGestionesPorPerderView (alcance RRHH: todos los
    funcionarios) y AlertaGestionesJefeAreaView (alcance acotado a los
    subordinados de un Jefe de Area vía JerarquiaAprobacion).

    Se excluyen los que ya pasaron su fecha límite: esos días ya se perdieron
    y avisar no sirve de nada.
    """
    hoy       = hoy or date.today()
    horizonte = _sumar_meses(hoy, _ANTICIPO_RIESGO_MESES)

    gestiones_map = {
        gv.cod_funcionario_id: gv
        for gv in GestionVacacion.objects.filter(cod_funcionario__in=funcionarios)
    }
    protegidos_map = {}
    for cod, anio in AcuerdoVacacionFuncionario.objects.filter(
        cod_funcionario__in=funcionarios,
        id_acuerdo__activo=True,
        id_acuerdo__fecha_hasta__gte=hoy,
    ).values_list('cod_funcionario', 'anio_gestion'):
        protegidos_map.setdefault(cod, set()).add(anio)

    alertas = []
    for f in funcionarios:
        gv = gestiones_map.get(f.cod_funcionario)
        if not gv:
            continue

        # Las gestiones protegidas por un acuerdo vigente no están en riesgo.
        ocupados = gestiones_ocupadas(gv, protegidos_map.get(f.cod_funcionario, set()))
        if len(ocupados) < LIMITE_GESTIONES_ACTIVAS:
            continue

        # Se simula "dentro de _ANTICIPO_RIESGO_MESES" para detectar el
        # riesgo con antelación, no solo el día exacto del aniversario.
        esperadas = calcular_gestioneS_pendientes(f.fecha_ingreso, horizonte)
        if not esperadas:
            continue
        anio_mas_reciente_esperado = esperadas[-1][1]  # última tupla = más reciente
        anios_actuales = {anio for _, anio, _ in ocupados}
        if anio_mas_reciente_esperado in anios_actuales:
            continue  # ya está al día, no hay gestión nueva pendiente de acreditar

        # Fecha límite: el aniversario exacto en que se vuelve elegible
        # para la gestión nueva -y por lo tanto el día desde el cual una
        # acreditación evictaría la gestión más antigua-.
        try:
            fecha_limite = f.fecha_ingreso.replace(year=anio_mas_reciente_esperado)
        except ValueError:
            fecha_limite = date(anio_mas_reciente_esperado, 3, 1)

        if fecha_limite < hoy:
            continue  # ya venció: los días se perdieron, no hay nada que avisar

        _, anio_riesgo, dias_riesgo = ocupados[0]  # año ascendente = más antigua

        p = f.ci
        alertas.append({
            'nombre':          f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip(),
            'ci':              p.ci,
            'cod':             f.cod_funcionario,
            'unidad':          f.id_unidad.nombre if f.id_unidad else '—',
            'anio_en_riesgo':  anio_riesgo,
            'dias':            float(dias_riesgo or 0),
            'fecha_limite':    fecha_limite.strftime('%d/%m/%Y'),
            '_fecha_limite_dt': fecha_limite,
        })

    alertas.sort(key=lambda a: a['_fecha_limite_dt'])
    for a in alertas:
        del a['_fecha_limite_dt']

    return alertas


class AlertaGestionesPorPerderView(APIView):
    """
    Alerta de gestiones por vencer para RRHH, a nivel de todos los
    funcionarios activos. Solo RRHH/Administrador.
    """
    permission_classes = [NoCambioPendiente, EsRRHH]

    def get(self, request):
        tiene_acceso, _ = _check_acceso_historial(request)
        if not tiene_acceso:
            return Response({'error': 'Sin acceso.'}, status=status.HTTP_403_FORBIDDEN)

        funcionarios = Funcionario.objects.filter(estado='ACTIVO').select_related('ci', 'id_unidad')
        return Response({'funcionarios': _calcular_alertas_gestiones_vencidas(funcionarios)})


class AlertaGestionesJefeAreaView(APIView):
    """
    Misma alerta que AlertaGestionesPorPerderView, pero acotada a los
    subordinados del aprobador autenticado (vía JerarquiaAprobacion activa),
    para que un Jefe de Area/Gerente vea solo a su gente a cargo.
    """
    permission_classes = [NoCambioPendiente, EsAprobador]

    def get(self, request):
        try:
            aprobador = _get_funcionario(request)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        roles = set(FuncionarioRol.objects.filter(
            cod_funcionario=aprobador, activo=True
        ).values_list('id_roles__tipo_rol', flat=True))
        if not (roles & _ROLES_APROBADOR):
            return Response({'funcionarios': []})

        cod_subordinados = JerarquiaAprobacion.objects.filter(
            cod_aprobador=aprobador, activo=True
        ).values_list('cod_funcionario_id', flat=True)

        subordinados = Funcionario.objects.filter(
            estado='ACTIVO', cod_funcionario__in=cod_subordinados
        ).select_related('ci', 'id_unidad')

        return Response({'funcionarios': _calcular_alertas_gestiones_vencidas(subordinados)})


# ══════════════════════════════════════════════════════════════════════════════
#  ALERTA: hoy toca poblar (aniversario del día, ajustado a día hábil)
# ══════════════════════════════════════════════════════════════════════════════

class AlertaPoblarHoyView(APIView):
    """
    Funcionarios cuyo aniversario de ingreso -ajustado al siguiente día hábil
    si cayó en fin de semana o feriado- ya se cumplió y cuya gestión
    correspondiente todavía no fue acreditada. Es un recordatorio persistente
    (no desaparece si RRHH no lo atiende el mismo día) para que sepa que le
    corresponde correr "Poblar Vacaciones" para ese funcionario. Solo
    RRHH/Administrador.
    """
    permission_classes = [NoCambioPendiente, EsRRHH]

    def get(self, request):
        tiene_acceso, _ = _check_acceso_historial(request)
        if not tiene_acceso:
            return Response({'error': 'Sin acceso.'}, status=status.HTTP_403_FORBIDDEN)

        hoy = date.today()
        feriados_set = set(Feriado.objects.values_list('fecha', flat=True))

        funcionarios = Funcionario.objects.filter(estado='ACTIVO').select_related('ci', 'id_unidad')
        gestiones_map = {
            gv.cod_funcionario_id: gv
            for gv in GestionVacacion.objects.filter(cod_funcionario__in=funcionarios)
        }

        resultado = []
        for f in funcionarios:
            esperadas = calcular_gestioneS_pendientes(f.fecha_ingreso, hoy)
            if not esperadas:
                continue
            anio_pendiente = esperadas[-1][1]

            gv = gestiones_map.get(f.cod_funcionario)
            anios_actuales = set()
            if gv:
                anios_actuales = {
                    getattr(gv, f'anio_gestion{i}')
                    for i in range(1, 5)
                    if getattr(gv, f'anio_gestion{i}') is not None
                }
            if anio_pendiente in anios_actuales:
                continue  # ya acreditada

            try:
                aniversario = f.fecha_ingreso.replace(year=anio_pendiente)
            except ValueError:
                aniversario = date(anio_pendiente, 3, 1)

            if _siguiente_dia_habil(aniversario, feriados_set) > hoy:
                continue  # todavía no corresponde (ajustado a día hábil)

            p = f.ci
            resultado.append({
                'nombre':          f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip(),
                'ci':              p.ci,
                'cod':             f.cod_funcionario,
                'unidad':          f.id_unidad.nombre if f.id_unidad else '—',
                'anio_pendiente':  anio_pendiente,
                'aniversario':     aniversario.strftime('%d/%m/%Y'),
                '_aniversario_dt': aniversario,
            })

        resultado.sort(key=lambda a: a['_aniversario_dt'])
        for a in resultado:
            del a['_aniversario_dt']

        return Response({'funcionarios': resultado})


# ══════════════════════════════════════════════════════════════════════════════
#  MÓDULO: ACUERDOS DE VACACIÓN (RRHH)
#  Suspensión/prórroga: las gestiones afectadas no se pierden por el tope de
#  gestiones activas mientras el acuerdo esté activo y vigente.
# ══════════════════════════════════════════════════════════════════════════════

def _parse_fecha(valor):
    try:
        return date.fromisoformat(str(valor))
    except (TypeError, ValueError):
        return None


class AcuerdosVacacionView(APIView):
    """GET: acuerdos + funcionarios activos para seleccionar. POST: registra un acuerdo COLECTIVO."""
    permission_classes = [NoCambioPendiente, EsRRHH]

    def get(self, request):
        tiene_acceso, f_user = _check_acceso_historial(request)
        if not tiene_acceso:
            return Response({'error': 'Sin acceso.'}, status=status.HTTP_403_FORBIDDEN)

        hoy = date.today()
        afectados_por_acuerdo = {}
        for a in AcuerdoVacacionFuncionario.objects.select_related('cod_funcionario__ci'):
            p = a.cod_funcionario.ci
            afectados_por_acuerdo.setdefault(a.id_acuerdo_id, []).append({
                'nombre': f"{p.nombre} {p.ap_paterno}".strip(),
                'anio':   a.anio_gestion,
            })

        acuerdos = [{
            'id':             ac.id_acuerdo,
            'tipo':           ac.tipo,
            'nro_documento':  ac.nro_documento or '—',
            'motivo':         ac.motivo,
            'fecha_acuerdo':  ac.fecha_acuerdo.isoformat(),
            'fecha_hasta':    ac.fecha_hasta.isoformat(),
            'solicitud':      f"G{ac.id_formulario_id:03d}" if ac.id_formulario_id else None,
            'registrado_por': (
                f"{ac.registrado_por.ci.nombre} {ac.registrado_por.ci.ap_paterno}".strip()
                if ac.registrado_por else '—'
            ),
            'vigente':        ac.activo and ac.fecha_hasta >= hoy,
            'activo':         ac.activo,
            'afectados':      afectados_por_acuerdo.get(ac.id_acuerdo, []),
        } for ac in AcuerdoVacacion.objects.select_related('registrado_por__ci').order_by('-fecha_registro')]

        funcionarios = [{
            'cod':       f.cod_funcionario,
            'nombre':    f"{f.ci.nombre} {f.ci.ap_paterno} {f.ci.ap_materno or ''}".strip(),
            'id_unidad': f.id_unidad_id,
        } for f in Funcionario.objects.filter(estado='ACTIVO').select_related('ci').order_by('ci__ap_paterno', 'ci__nombre')]

        roles_activos = list(FuncionarioRol.objects.filter(
            cod_funcionario=f_user, activo=True
        ).values_list('id_roles__tipo_rol', flat=True))
        if 'Funcionario' not in roles_activos:
            roles_activos.insert(0, 'Funcionario')

        return Response({
            'acuerdos':     acuerdos,
            'funcionarios': funcionarios,
            'unidades':     list(UnidadOrganizacional.objects.filter(activo=True)
                                 .values('id_unidad', 'nombre').order_by('nombre')),
            'usuario': {
                'nombre': f"{f_user.ci.nombre} {f_user.ci.ap_paterno}".strip(),
                'roles':  roles_activos,
            },
        })

    def post(self, request):
        tiene_acceso, f_user = _check_acceso_historial(request)
        if not tiene_acceso:
            return Response({'error': 'Sin acceso.'}, status=status.HTTP_403_FORBIDDEN)

        nro_documento = str(request.data.get('nro_documento', '')).strip()
        motivo        = str(request.data.get('motivo', '')).strip()
        fecha_acuerdo = _parse_fecha(request.data.get('fecha_acuerdo'))
        fecha_hasta   = _parse_fecha(request.data.get('fecha_hasta'))
        cods          = request.data.get('funcionarios') or []

        if not nro_documento or len(nro_documento) > 60:
            return Response({'error': 'Ingrese el N° de documento del acuerdo (máx. 60 caracteres).'}, status=status.HTTP_400_BAD_REQUEST)
        if len(motivo) < 10:
            return Response({'error': 'El motivo debe tener al menos 10 caracteres.'}, status=status.HTTP_400_BAD_REQUEST)
        if not fecha_acuerdo or not fecha_hasta:
            return Response({'error': 'Fechas inválidas.'}, status=status.HTTP_400_BAD_REQUEST)
        if fecha_hasta <= fecha_acuerdo or fecha_hasta < date.today():
            return Response({'error': 'La nueva fecha límite debe ser posterior a la del acuerdo y a hoy.'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(cods, list) or not cods:
            return Response({'error': 'Seleccione al menos un funcionario.'}, status=status.HTTP_400_BAD_REQUEST)

        # Se protegen las gestiones activas de cada funcionario al momento del acuerdo.
        filas = [
            (gv.cod_funcionario_id, anio)
            for gv in GestionVacacion.objects.filter(
                cod_funcionario__in=[str(c) for c in cods], cod_funcionario__estado='ACTIVO'
            )
            for _, anio, _ in gestiones_ocupadas(gv)
        ]
        if not filas:
            return Response({'error': 'Los funcionarios seleccionados no tienen gestiones activas.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            acuerdo = AcuerdoVacacion.objects.create(
                tipo='COLECTIVO',
                nro_documento=nro_documento,
                motivo=motivo,
                fecha_acuerdo=fecha_acuerdo,
                fecha_hasta=fecha_hasta,
                registrado_por=f_user,
            )
            AcuerdoVacacionFuncionario.objects.bulk_create([
                AcuerdoVacacionFuncionario(id_acuerdo=acuerdo, cod_funcionario_id=cod, anio_gestion=anio)
                for cod, anio in filas
            ])

        return Response({
            'ok':           True,
            'id':           acuerdo.id_acuerdo,
            'funcionarios': len({cod for cod, _ in filas}),
            'gestiones':    len(filas),
        }, status=status.HTTP_201_CREATED)


class RevocarAcuerdoView(APIView):
    """Desactiva un acuerdo (no se borra: queda para auditoría)."""
    permission_classes = [NoCambioPendiente, EsRRHH]

    def post(self, request, id_acuerdo):
        tiene_acceso, _ = _check_acceso_historial(request)
        if not tiene_acceso:
            return Response({'error': 'Sin acceso.'}, status=status.HTTP_403_FORBIDDEN)
        actualizados = AcuerdoVacacion.objects.filter(id_acuerdo=id_acuerdo, activo=True).update(activo=False)
        if not actualizados:
            return Response({'error': 'Acuerdo no encontrado o ya revocado.'}, status=status.HTTP_404_NOT_FOUND)
        return Response({'ok': True})
