from datetime import date

from django.db.models import Q
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.api_permissions import NoCambioPendiente, EsAuditoria
from core.models import UnidadOrganizacional
from accounts.models import FuncionarioRol
from employees.models import Funcionario, HistorialCargo
from vacations.models import GestionVacacion, SolicitudVacacion

_ROLES_REPORTE_P = {'RRHH', 'Auditoria', 'Administrador'}
_ROLES_DIAS_PERDIDOS = {'RRHH', 'Administrador'}

_ROL_AREA_LABEL = {
    'RRHH':          'RECURSOS HUMANOS',
    'Auditoria':     'AUDITORIA',
    'Administrador': 'ADMINISTRACIÓN',
}


def _area_label_usuario(roles):
    for rol in ('Administrador', 'RRHH', 'Auditoria'):
        if rol in roles:
            return _ROL_AREA_LABEL[rol]
    return 'RECURSOS HUMANOS'


def _nombre_rrhh_activo():
    fr = FuncionarioRol.objects.filter(
        id_roles__tipo_rol='RRHH', activo=True
    ).select_related('cod_funcionario__ci').first()
    if not fr:
        return ''
    p = fr.cod_funcionario.ci
    return f"{p.nombre} {p.ap_paterno}"


def _get_funcionario_y_roles(username):
    f = Funcionario.objects.get(ci__ci=username, estado='ACTIVO')
    roles = set(FuncionarioRol.objects.filter(
        cod_funcionario=f, activo=True
    ).values_list('id_roles__tipo_rol', flat=True))
    return f, roles


class UnidadesReporteView(APIView):
    permission_classes = [NoCambioPendiente, EsAuditoria]

    def get(self, request):
        try:
            _, roles = _get_funcionario_y_roles(request.user.username)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        if not (roles & _ROLES_REPORTE_P):
            return Response({'error': 'Sin acceso.'}, status=status.HTTP_403_FORBIDDEN)

        unidades = list(
            UnidadOrganizacional.objects.filter(activo=True)
            .order_by('nombre')
            .values('id_unidad', 'nombre')
        )
        return Response({
            'unidades':    unidades,
            'area_label':  _area_label_usuario(roles),
            'nombre_rrhh': _nombre_rrhh_activo(),
        })


class FuncionariosReporteView(APIView):
    permission_classes = [NoCambioPendiente, EsAuditoria]

    def get(self, request):
        try:
            _, roles = _get_funcionario_y_roles(request.user.username)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        if not (roles & _ROLES_REPORTE_P):
            return Response({'error': 'Sin acceso.'}, status=status.HTTP_403_FORBIDDEN)

        puede_ver_dias_perdidos = bool(roles & _ROLES_DIAS_PERDIDOS)

        unidad_id = request.GET.get('unidad', '').strip()
        tipo_cont = request.GET.get('tipo_contrato', '').strip()
        nombre_b  = request.GET.get('funcionario', '').strip()

        qs = Funcionario.objects.filter(estado='ACTIVO').select_related('ci', 'id_unidad')

        if unidad_id:
            qs = qs.filter(id_unidad=unidad_id)
        if tipo_cont:
            cods_tipo = list(HistorialCargo.objects.filter(
                es_actual=True, tipo_contrato=tipo_cont
            ).values_list('cod_funcionario', flat=True))
            qs = qs.filter(cod_funcionario__in=cods_tipo)
        if nombre_b:
            qs = qs.filter(
                Q(ci__nombre__icontains=nombre_b) |
                Q(ci__ap_paterno__icontains=nombre_b)
            )

        funcionarios = list(qs.order_by('ci__ap_paterno', 'ci__nombre'))
        cods = [f.cod_funcionario for f in funcionarios]

        cargos_map = {
            hc.cod_funcionario_id: hc
            for hc in HistorialCargo.objects.filter(cod_funcionario__in=cods, es_actual=True)
        }
        gestiones_map = {
            gv.cod_funcionario_id: gv
            for gv in GestionVacacion.objects.filter(cod_funcionario__in=cods)
        }

        result = []
        current_year = date.today().year
        for f in funcionarios:
            hc = cargos_map.get(f.cod_funcionario)
            gv = gestiones_map.get(f.cod_funcionario)
            am = f.ci.ap_materno or ''

            if gv:
                anios_dict = {}
                for i in range(1, 5):
                    anio = getattr(gv, f'anio_gestion{i}', None)
                    dias = float(getattr(gv, f'dias_gestion{i}') or 0)
                    if anio is not None:
                        anios_dict[anio] = dias
                gestiones = [
                    {'anio': yr if yr in anios_dict else None, 'dias': anios_dict.get(yr, 0.0)}
                    for yr in [current_year, current_year - 1, current_year - 2]
                ]
            else:
                gestiones = [{'anio': None, 'dias': 0.0} for _ in range(3)]

            row = {
                'cod':              f.cod_funcionario,
                'nombre_completo':  f"{f.ci.nombre} {f.ci.ap_paterno} {am}".strip(),
                'apellidos_nombres':f"{f.ci.ap_paterno} {am} {f.ci.nombre}".strip(),
                'nombre_firma':     f"{f.ci.nombre} {f.ci.ap_paterno}",
                'cargo':            hc.cargo if hc else '',
                'tipo_contrato':    hc.tipo_contrato if hc else '',
                'unidad':           f.id_unidad.nombre if f.id_unidad else '',
                'fecha_ingreso':    f.fecha_ingreso.strftime('%d/%m/%Y') if f.fecha_ingreso else '',
                'gestiones':        gestiones,
                'dias_negados':     float(gv.dias_negados) if gv else 0.0,
                'dias_adeudados':   float(gv.dias_adeudados or 0) if gv else 0.0,
            }
            if puede_ver_dias_perdidos:
                row['dias_perdidos'] = float(gv.dias_perdidos) if gv else 0.0
            result.append(row)

        result.sort(key=lambda r: r['dias_adeudados'], reverse=True)

        return Response({
            'funcionarios': result,
            'total': len(result),
            'puede_ver_dias_perdidos': puede_ver_dias_perdidos,
        })


class HistorialReporteView(APIView):
    permission_classes = [NoCambioPendiente, EsAuditoria]

    def get(self, request):
        try:
            _, roles = _get_funcionario_y_roles(request.user.username)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        if not (roles & _ROLES_REPORTE_P):
            return Response({'error': 'Sin acceso.'}, status=status.HTTP_403_FORBIDDEN)

        cod = request.GET.get('cod', '').strip()
        if not cod:
            return Response({'error': 'Falta cod.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            f = Funcionario.objects.select_related('ci', 'id_unidad').get(
                cod_funcionario=cod, estado='ACTIVO'
            )
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        hc = HistorialCargo.objects.filter(cod_funcionario=f, es_actual=True).first()
        gv = GestionVacacion.objects.filter(cod_funcionario=f).first()

        solicitudes = SolicitudVacacion.objects.filter(
            cod_funcionario=f, estado='APROBADA'
        ).order_by('fecha_salida')

        historial = {}
        for sol in solicitudes:
            anio = str(sol.fecha_salida.year)
            if anio not in historial:
                historial[anio] = []
            historial[anio].append({
                'inicio': sol.fecha_salida.strftime('%d/%m/%Y'),
                'fin':    sol.fecha_retorno.strftime('%d/%m/%Y'),
                'dias':   float(sol.dias_solicitados),
            })

        for sols in historial.values():
            for i, s in enumerate(sols):
                s['nro'] = i + 1

        am = f.ci.ap_materno or ''
        return Response({
            'cod':               f.cod_funcionario,
            'nombre_completo':   f"{f.ci.nombre} {f.ci.ap_paterno} {am}".strip(),
            'apellidos_nombres': f"{f.ci.ap_paterno} {am} {f.ci.nombre}".strip(),
            'nombre_firma':      f"{f.ci.nombre} {f.ci.ap_paterno}",
            'cargo':             hc.cargo if hc else '',
            'fecha_ingreso':     f.fecha_ingreso.strftime('%d/%m/%Y') if f.fecha_ingreso else '',
            'dias_adeudados':    float(gv.dias_adeudados or 0) if gv else 0.0,
            'historial':         historial,
        })
