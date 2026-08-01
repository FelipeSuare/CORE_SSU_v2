from datetime import date
from django.http import JsonResponse
from django.shortcuts import render
from django.contrib.auth.decorators import login_required

from core.roles import obtener_roles
from employees.api_views import _serializar_funcionario
from employees.models import Funcionario
from reports.api_views import _area_label_usuario

_ROLES_EMPLOYEES = frozenset({'RRHH', 'Administrador'})
_ROLES_HISTORIAL = frozenset({'Administrador', 'Auditoria'})


@login_required(login_url='login_home')
def funcionarios_view(request):
    roles = obtener_roles(request.user.username)
    if not (roles & _ROLES_EMPLOYEES):
        return render(request, 'shared/sin_acceso.html', status=403)
    return render(request, 'employees/Funcionarios.html')


@login_required(login_url='login_home')
def historial_cargos_view(request):
    roles = obtener_roles(request.user.username)
    if not (roles & _ROLES_HISTORIAL):
        return render(request, 'shared/sin_acceso.html', status=403)
    return render(request, 'employees/HistorialCargos.html')


@login_required(login_url='login_home')
def exportar_funcionarios(request):
    roles = obtener_roles(request.user.username)
    if not (roles & _ROLES_EMPLOYEES):
        return JsonResponse({'error': 'No tiene permisos para exportar funcionarios.'}, status=403)

    unidad = request.GET.get('unidad', '').strip()
    cargo  = request.GET.get('cargo', '').strip().lower()
    estado = request.GET.get('estado', '').strip().upper()

    qs = Funcionario.objects.select_related('ci', 'id_unidad').order_by('estado', 'ci__ap_paterno')

    if unidad:
        qs = qs.filter(id_unidad__nombre=unidad)
    if estado in ('ACTIVO', 'INACTIVO'):
        qs = qs.filter(estado=estado)

    filas = []
    for f in qs:
        datos = _serializar_funcionario(f)
        if cargo and cargo not in datos['cargo'].lower():
            continue
        filas.append(datos)

    filtros = []
    if unidad:
        filtros.append(f'Unidad: {unidad}')
    if cargo:
        filtros.append(f'Cargo contiene: "{cargo}"')
    if estado in ('ACTIVO', 'INACTIVO'):
        filtros.append(f'Estado: {estado.capitalize()}')

    return JsonResponse({
        'funcionarios': filas,
        'fecha':        date.today().strftime('%d/%m/%Y'),
        'filtros':      filtros,
        'area_label':   _area_label_usuario(roles),
    })
