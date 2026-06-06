import json
from datetime import date
from django.db.models import Q
from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.db import transaction, connection, IntegrityError

from core.models import UnidadOrganizacional
from employees.models import Persona, Funcionario, HistorialCargo
from accounts.models import Roles, FuncionarioRol
from vacations.models import GestionVacacion, JerarquiaAprobacion
from vacations.utils import calcular_anios_antiguedad

_NIVELES = {
    'PERSONAL DE AREA':      3,
    'JEFE AREA':             2,
    'DEPENDENCIA DIRECTA':   1,
    'GERENTE ADMINISTRATIVO':1,
    'GERENTE SALUD':         1,
    'GERENTE GENERAL':       0,
}

_ROLES_EMPLOYEES  = frozenset({'RRHH', 'Administrador'})
_ROLES_HISTORIAL  = frozenset({'Administrador', 'Auditoria'})

_ROL_LABEL = {
    'Administrador': 'ADMINISTRADOR',
    'Auditoria':     'AUDITORÍA',
}
_ROL_PRIORIDAD = ['Administrador', 'Auditoria']


def _get_roles_usuario(request):
    ci = request.user.username
    try:
        f = Funcionario.objects.get(ci__ci=ci, estado='ACTIVO')
        return set(FuncionarioRol.objects.filter(
            cod_funcionario=f, activo=True
        ).values_list('id_roles__tipo_rol', flat=True))
    except Funcionario.DoesNotExist:
        return set()


def _check_acceso_employees(request):
    return bool(_get_roles_usuario(request) & _ROLES_EMPLOYEES)


def _calcular_antiguedad(fecha_ingreso):
    if not fecha_ingreso:
        return '-'
    hoy = date.today()
    a = hoy.year - fecha_ingreso.year
    m = hoy.month - fecha_ingreso.month
    if m < 0:
        a -= 1
        m += 12
    return f"{a}a {m}m"


def _siguiente_cod_funcionario():
    with connection.cursor() as cur:
        cur.execute("""
            SELECT COALESCE(MAX(
                CASE WHEN cod_funcionario ~ '^[0-9]+$'
                THEN CAST(cod_funcionario AS INTEGER)
                ELSE 0 END
            ), 0) + 1
            FROM funcionario
        """)
        return str(cur.fetchone()[0])


def _serializar_funcionario(f):
    p = f.ci
    cargo_act = HistorialCargo.objects.filter(cod_funcionario=f, es_actual=True).first()
    if not cargo_act:
        # Para inactivos: el último cargo registrado (es_actual=False)
        cargo_act = HistorialCargo.objects.filter(cod_funcionario=f).order_by('-fecha_inicio').first()
    roles = list(
        FuncionarioRol.objects.filter(cod_funcionario=f, activo=True)
        .values_list('id_roles__tipo_rol', flat=True)
    )
    jerarquia = [
        {
            'nivel':           j.nivel_aprobacion,
            'aprobador_cod':   j.cod_aprobador.cod_funcionario,
            'aprobador_nombre': f"{j.cod_aprobador.ci.nombre} {j.cod_aprobador.ci.ap_paterno}",
        }
        for j in JerarquiaAprobacion.objects.filter(
            cod_funcionario=f, activo=True
        ).select_related('cod_aprobador__ci').order_by('nivel_aprobacion')
    ]
    fecha_baja = f.fecha_baja.strftime('%Y-%m-%d') if f.fecha_baja else ''
    return {
        'cod':              f.cod_funcionario,
        'ci':               p.ci,
        'nombre':           p.nombre,
        'ap_paterno':       p.ap_paterno,
        'ap_materno':       p.ap_materno or '',
        'fecha_nacimiento': p.fecha_nacimiento.strftime('%Y-%m-%d') if p.fecha_nacimiento else '',
        'sexo':             p.sexo,
        'matricula_seguro': f.matricula_seguro or '',
        'cargo':            cargo_act.cargo if cargo_act else '',
        'tipo_contrato':    cargo_act.tipo_contrato if cargo_act else '',
        'unidad':           f.id_unidad.nombre,
        'fecha_ingreso':    f.fecha_ingreso.strftime('%Y-%m-%d'),
        'tipo_funcionario': f.tipo_funcionario,
        'estado':           f.estado,
        'antiguedad':       _calcular_antiguedad(f.fecha_ingreso),
        'fecha_baja':       fecha_baja,
        'roles':            roles,
        'jerarquia':        jerarquia,
    }


# ──────────────────────────────────────────────────────────────
#  Página principal
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def funcionarios_view(request):
    if not _check_acceso_employees(request):
        return render(request, 'shared/sin_acceso.html', status=403)
    return render(request, 'employees/Funcionarios.html')


@login_required(login_url='login_home')
def historial_cargos_view(request):
    if not (_get_roles_usuario(request) & _ROLES_HISTORIAL):
        return render(request, 'shared/sin_acceso.html', status=403)
    return render(request, 'employees/HistorialCargos.html')


# ──────────────────────────────────────────────────────────────
#  Listar funcionarios
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def listar_funcionarios(request):
    estado = request.GET.get('estado', 'ACTIVO').upper()
    q      = request.GET.get('q', '').strip().lower()

    qs = Funcionario.objects.select_related('ci', 'id_unidad').filter(estado=estado)

    resultado = []
    for f in qs:
        datos = _serializar_funcionario(f)
        if q:
            buscar = f"{datos['ci']} {datos['nombre']} {datos['ap_paterno']} {datos['ap_materno']} {datos['cargo']}".lower()
            if q not in buscar:
                continue
        resultado.append(datos)

    return JsonResponse({'funcionarios': resultado})


# ──────────────────────────────────────────────────────────────
#  Aprobadores para los selects del modal
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def aprobadores_api(request):
    excluir = request.GET.get('excluir', None)

    def por_rol(tipo_rol):
        cods = list(
            FuncionarioRol.objects.filter(id_roles__tipo_rol=tipo_rol, activo=True)
            .values_list('cod_funcionario_id', flat=True)
        )
        out = []
        for cod in cods:
            if cod == excluir:
                continue
            try:
                f = Funcionario.objects.select_related('ci').get(cod_funcionario=cod, estado='ACTIVO')
                cargo_act = HistorialCargo.objects.filter(cod_funcionario=f, es_actual=True).first()
                out.append({
                    'cod':    f.cod_funcionario,
                    'nombre': f"{f.ci.nombre} {f.ci.ap_paterno} {f.ci.ap_materno or ''}".strip(),
                    'cargo':  cargo_act.cargo if cargo_act else '',
                })
            except Funcionario.DoesNotExist:
                pass
        return out

    roles_qs = Roles.objects.filter(tipo_rol__in=[
        'Jefe de Area', 'Gerente Administrativo', 'Gerente de Salud', 'Gerente General'
    ])
    descripciones = {r.tipo_rol: r.descripcion or '' for r in roles_qs}

    return JsonResponse({
        'jefes_area':      por_rol('Jefe de Area'),
        'gerentes':        por_rol('Gerente Administrativo') + por_rol('Gerente de Salud'),
        'gerente_general': por_rol('Gerente General'),
        'descripciones':   descripciones,
    })


# ──────────────────────────────────────────────────────────────
#  Nuevo funcionario
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
@require_POST
def nuevo_funcionario(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Solicitud inválida.'}, status=400)

    ci               = data.get('ci', '').strip()
    nombres          = data.get('nombres', '').strip()
    ap_paterno       = data.get('ap_paterno', '').strip()
    ap_materno       = data.get('ap_materno', '').strip()
    fecha_nac_str    = data.get('fecha_nacimiento', '').strip()
    sexo             = data.get('sexo', '').strip()
    matricula_seguro = data.get('matricula_seguro', '').strip() or None
    cargo            = data.get('cargo', '').strip()
    tipo_contrato    = data.get('tipo_contrato', '').strip()
    unidad_nombre    = data.get('unidad', '').strip()
    fecha_ing_str    = data.get('fecha_ingreso', '').strip()
    tipo_func        = data.get('tipo_funcionario', '').strip()
    roles_nombres    = list(data.get('roles', ['Funcionario']))
    jerarquia        = data.get('jerarquia', [])

    if not all([ci, nombres, ap_paterno, fecha_nac_str, sexo, cargo,
                tipo_contrato, unidad_nombre, fecha_ing_str, tipo_func]):
        return JsonResponse({'error': 'Todos los campos obligatorios deben completarse.'}, status=400)

    if Persona.objects.filter(ci=ci).exists():
        return JsonResponse({'error': f'Ya existe un funcionario con CI {ci}.'}, status=400)

    try:
        fecha_nac = date.fromisoformat(fecha_nac_str)
        fecha_ing = date.fromisoformat(fecha_ing_str)
    except ValueError:
        return JsonResponse({'error': 'Formato de fecha inválido.'}, status=400)

    try:
        unidad = UnidadOrganizacional.objects.get(nombre=unidad_nombre)
    except UnidadOrganizacional.DoesNotExist:
        return JsonResponse({'error': f'Unidad "{unidad_nombre}" no encontrada.'}, status=400)

    if 'Funcionario' not in roles_nombres:
        roles_nombres.insert(0, 'Funcionario')

    cod = None
    try:
        with transaction.atomic():
            persona = Persona.objects.create(
                ci=ci, nombre=nombres, ap_paterno=ap_paterno,
                ap_materno=ap_materno or None,
                fecha_nacimiento=fecha_nac, sexo=sexo,
            )
            cod = _siguiente_cod_funcionario()
            funcionario = Funcionario.objects.create(
                cod_funcionario=cod, ci=persona, id_unidad=unidad,
                fecha_ingreso=fecha_ing, tipo_funcionario=tipo_func,
                estado='ACTIVO', contrasena_hash='1234567',
                matricula_seguro=matricula_seguro,
            )
            HistorialCargo.objects.create(
                cod_funcionario=funcionario, cargo=cargo,
                tipo_contrato=tipo_contrato, fecha_inicio=fecha_ing, es_actual=True,
            )
            for rol_nombre in set(roles_nombres):
                try:
                    rol = Roles.objects.get(tipo_rol=rol_nombre)
                    FuncionarioRol.objects.create(
                        cod_funcionario=funcionario, id_roles=rol, activo=True,
                    )
                except Roles.DoesNotExist:
                    pass
            for j in jerarquia:
                aprobador_cod = j.get('aprobador_cod', '').strip()
                nivel         = int(j.get('nivel', 0))
                if not aprobador_cod or not nivel:
                    continue
                try:
                    aprobador = Funcionario.objects.get(cod_funcionario=aprobador_cod)
                    JerarquiaAprobacion.objects.create(
                        cod_funcionario=funcionario, cod_aprobador=aprobador,
                        nivel_aprobacion=nivel, activo=True,
                    )
                except Funcionario.DoesNotExist:
                    pass
            if not User.objects.filter(username=ci).exists():
                User.objects.create_user(username=ci, password='1234567')

            # Crear y poblar gestión de vacaciones según la Ley General del Trabajo
            from vacations.utils import poblar_gestion_vacacion
            poblar_gestion_vacacion(funcionario)

    except IntegrityError as e:
        return JsonResponse({'error': f'Error de base de datos: {e}'}, status=400)

    return JsonResponse({'ok': True, 'cod': cod}, status=201)


# ──────────────────────────────────────────────────────────────
#  Editar funcionario
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
@require_POST
def editar_funcionario(request, cod):
    try:
        funcionario = Funcionario.objects.select_related('ci', 'id_unidad').get(cod_funcionario=cod)
    except Funcionario.DoesNotExist:
        return JsonResponse({'error': 'Funcionario no encontrado.'}, status=404)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Solicitud inválida.'}, status=400)

    nombres          = data.get('nombres', '').strip()
    ap_paterno       = data.get('ap_paterno', '').strip()
    ap_materno       = data.get('ap_materno', '').strip()
    fecha_nac_str    = data.get('fecha_nacimiento', '').strip()
    sexo             = data.get('sexo', '').strip()
    matricula_seguro = data.get('matricula_seguro', '').strip() or None
    cargo            = data.get('cargo', '').strip()
    tipo_contrato    = data.get('tipo_contrato', '').strip()
    unidad_nombre    = data.get('unidad', '').strip()
    fecha_ing_str    = data.get('fecha_ingreso', '').strip()
    tipo_func        = data.get('tipo_funcionario', '').strip()
    roles_nombres    = list(data.get('roles', ['Funcionario']))
    jerarquia        = data.get('jerarquia', [])

    if not all([nombres, ap_paterno, fecha_nac_str, sexo, cargo,
                tipo_contrato, unidad_nombre, fecha_ing_str, tipo_func]):
        return JsonResponse({'error': 'Todos los campos obligatorios deben completarse.'}, status=400)

    try:
        fecha_nac = date.fromisoformat(fecha_nac_str)
        fecha_ing = date.fromisoformat(fecha_ing_str)
    except ValueError:
        return JsonResponse({'error': 'Formato de fecha inválido.'}, status=400)

    try:
        unidad = UnidadOrganizacional.objects.get(nombre=unidad_nombre)
    except UnidadOrganizacional.DoesNotExist:
        return JsonResponse({'error': f'Unidad "{unidad_nombre}" no encontrada.'}, status=400)

    if 'Funcionario' not in roles_nombres:
        roles_nombres.insert(0, 'Funcionario')

    hoy = date.today()

    try:
        with transaction.atomic():
            p = funcionario.ci
            p.nombre           = nombres
            p.ap_paterno       = ap_paterno
            p.ap_materno       = ap_materno or None
            p.fecha_nacimiento = fecha_nac
            p.sexo             = sexo
            p.save(update_fields=['nombre', 'ap_paterno', 'ap_materno', 'fecha_nacimiento', 'sexo'])

            funcionario.id_unidad        = unidad
            funcionario.fecha_ingreso    = fecha_ing
            funcionario.tipo_funcionario = tipo_func
            funcionario.matricula_seguro = matricula_seguro
            funcionario.save(update_fields=['id_unidad', 'fecha_ingreso', 'tipo_funcionario', 'matricula_seguro'])

            cargo_act = HistorialCargo.objects.filter(cod_funcionario=funcionario, es_actual=True).first()
            if cargo_act and (cargo_act.cargo != cargo or cargo_act.tipo_contrato != tipo_contrato):
                # Snapshot gestion_vacacion → historial_cargo al momento del cierre
                gv = GestionVacacion.objects.filter(cod_funcionario=funcionario).first()
                if gv:
                    cargo_act.saldo_gestion1_al_salir = gv.dias_gestion1
                    cargo_act.anio_gestion1_al_salir  = gv.anio_gestion1
                    cargo_act.saldo_gestion2_al_salir = gv.dias_gestion2
                    cargo_act.anio_gestion2_al_salir  = gv.anio_gestion2
                    cargo_act.saldo_gestion3_al_salir = gv.dias_gestion3
                    cargo_act.anio_gestion3_al_salir  = gv.anio_gestion3
                    cargo_act.saldo_gestion4_al_salir = gv.dias_gestion4
                    cargo_act.anio_gestion4_al_salir  = gv.anio_gestion4
                cargo_act.es_actual = False
                cargo_act.fecha_fin = hoy
                cargo_act.save(update_fields=[
                    'es_actual', 'fecha_fin',
                    'saldo_gestion1_al_salir', 'anio_gestion1_al_salir',
                    'saldo_gestion2_al_salir', 'anio_gestion2_al_salir',
                    'saldo_gestion3_al_salir', 'anio_gestion3_al_salir',
                    'saldo_gestion4_al_salir', 'anio_gestion4_al_salir',
                ])
                HistorialCargo.objects.create(
                    cod_funcionario=funcionario, cargo=cargo,
                    tipo_contrato=tipo_contrato, fecha_inicio=hoy, es_actual=True,
                )

            actuales = set(
                FuncionarioRol.objects.filter(cod_funcionario=funcionario, activo=True)
                .values_list('id_roles__tipo_rol', flat=True)
            )
            nuevos = set(roles_nombres)
            for rol_nombre in nuevos - actuales:
                try:
                    rol = Roles.objects.get(tipo_rol=rol_nombre)
                    FuncionarioRol.objects.create(
                        cod_funcionario=funcionario, id_roles=rol, activo=True,
                    )
                except Roles.DoesNotExist:
                    pass
            for rol_nombre in actuales - nuevos - {'Funcionario'}:
                FuncionarioRol.objects.filter(
                    cod_funcionario=funcionario,
                    id_roles__tipo_rol=rol_nombre, activo=True,
                ).update(activo=False, fecha_revocacion=hoy)

            for j in jerarquia:
                aprobador_cod = j.get('aprobador_cod', '').strip()
                nivel         = int(j.get('nivel', 0))
                if not aprobador_cod or not nivel:
                    continue
                actual = JerarquiaAprobacion.objects.filter(
                    cod_funcionario=funcionario, nivel_aprobacion=nivel, activo=True
                ).first()
                if actual:
                    if actual.cod_aprobador.cod_funcionario != aprobador_cod:
                        actual.activo    = False
                        actual.fecha_fin = hoy
                        actual.save(update_fields=['activo', 'fecha_fin'])
                        try:
                            aprobador = Funcionario.objects.get(cod_funcionario=aprobador_cod)
                            JerarquiaAprobacion.objects.create(
                                cod_funcionario=funcionario, cod_aprobador=aprobador,
                                nivel_aprobacion=nivel, activo=True,
                            )
                        except Funcionario.DoesNotExist:
                            pass
                else:
                    try:
                        aprobador = Funcionario.objects.get(cod_funcionario=aprobador_cod)
                        JerarquiaAprobacion.objects.create(
                            cod_funcionario=funcionario, cod_aprobador=aprobador,
                            nivel_aprobacion=nivel, activo=True,
                        )
                    except Funcionario.DoesNotExist:
                        pass

            nivel_max = _NIVELES.get(tipo_func, 0)
            JerarquiaAprobacion.objects.filter(
                cod_funcionario=funcionario, nivel_aprobacion__gt=nivel_max, activo=True,
            ).update(activo=False, fecha_fin=hoy)

    except IntegrityError as e:
        return JsonResponse({'error': f'Error de base de datos: {e}'}, status=400)

    return JsonResponse({'ok': True})


# ──────────────────────────────────────────────────────────────
#  Toggle estado (Activo ↔ Inactivo)
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
@require_POST
def toggle_estado(request, cod):
    try:
        f = Funcionario.objects.get(cod_funcionario=cod)
    except Funcionario.DoesNotExist:
        return JsonResponse({'error': 'Funcionario no encontrado.'}, status=404)

    try:
        data = json.loads(request.body) if request.body else {}
    except (json.JSONDecodeError, ValueError):
        data = {}

    nuevo_estado = 'INACTIVO' if f.estado == 'ACTIVO' else 'ACTIVO'

    if nuevo_estado == 'INACTIVO':
        fecha_baja_str = data.get('fecha_baja', '').strip()
        if not fecha_baja_str:
            return JsonResponse({'error': 'La fecha de baja es requerida.'}, status=400)
        try:
            fecha_baja = date.fromisoformat(fecha_baja_str)
        except ValueError:
            return JsonResponse({'error': 'Fecha de baja inválida.'}, status=400)

        cargo_act = HistorialCargo.objects.filter(cod_funcionario=f, es_actual=True).first()
        if cargo_act:
            cargo_act.es_actual = False
            cargo_act.save(update_fields=['es_actual'])

        f.fecha_baja = fecha_baja
        f.estado = nuevo_estado
        f.save(update_fields=['estado', 'fecha_baja'])
    else:
        f.fecha_baja = None
        f.estado = nuevo_estado
        f.save(update_fields=['estado', 'fecha_baja'])
    return JsonResponse({'ok': True, 'estado': f.estado})


# ──────────────────────────────────────────────────────────────
#  Exportar PDF (HTML imprimible)
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def exportar_funcionarios(request):
    unidad = request.GET.get('unidad', '').strip()
    cargo  = request.GET.get('cargo', '').strip().lower()
    estado = request.GET.get('estado', '').strip().upper()   # ACTIVO | INACTIVO | '' = todos

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

    # Etiqueta legible de los filtros activos
    filtros = []
    if unidad:
        filtros.append(f'Unidad: {unidad}')
    if cargo:
        filtros.append(f'Cargo contiene: "{cargo}"')
    if estado in ('ACTIVO', 'INACTIVO'):
        filtros.append(f'Estado: {estado.capitalize()}')

    return render(request, 'employees/ExportarFuncionarios.html', {
        'funcionarios': filas,
        'fecha':        date.today().strftime('%d/%m/%Y'),
        'filtros':      filtros,
    })


# ──────────────────────────────────────────────────────────────
#  Autocompletado de funcionarios
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def buscar_funcionarios(request):
    q = request.GET.get('q', '').strip()
    if len(q) < 2:
        return JsonResponse({'funcionarios': []})

    qs = (
        Funcionario.objects
        .select_related('ci')
        .filter(estado='ACTIVO')
        .filter(
            Q(ci__nombre__icontains=q) |
            Q(ci__ap_paterno__icontains=q) |
            Q(ci__ap_materno__icontains=q) |
            Q(ci__ci__icontains=q)
        )
        .order_by('ci__ap_paterno', 'ci__nombre')[:10]
    )

    resultado = [{
        'cod_funcionario': f.cod_funcionario,
        'nombre_completo': f"{f.ci.nombre} {f.ci.ap_paterno} {f.ci.ap_materno or ''}".strip(),
        'ci': f.ci.ci,
    } for f in qs]

    return JsonResponse({'funcionarios': resultado})


# ──────────────────────────────────────────────────────────────
#  Historial de cargos de un funcionario
# ──────────────────────────────────────────────────────────────

@login_required(login_url='login_home')
def historial_cargos_api(request, cod):
    roles = _get_roles_usuario(request)
    if not (roles & _ROLES_HISTORIAL):
        return JsonResponse({'error': 'No autorizado'}, status=403)

    try:
        f = Funcionario.objects.select_related('ci').get(cod_funcionario=cod)
    except Funcionario.DoesNotExist:
        return JsonResponse({'error': 'Funcionario no encontrado'}, status=404)

    cargos_qs = list(
        HistorialCargo.objects.filter(cod_funcionario=f).order_by('fecha_inicio')
    )

    gv = GestionVacacion.objects.filter(cod_funcionario=f).first()

    cargos = []
    for i, hc in enumerate(cargos_qs):
        if hc.es_actual:
            gestiones = [
                {'anio': getattr(gv, f'anio_gestion{n}'),
                 'saldo': float(getattr(gv, f'dias_gestion{n}') or 0)}
                for n in range(1, 5)
            ] if gv else [{'anio': None, 'saldo': 0.0}] * 4
            saldo_total = float(gv.dias_adeudados or 0) if gv else 0.0
        else:
            gestiones = [
                {'anio':  getattr(hc, f'anio_gestion{n}_al_salir'),
                 'saldo': float(getattr(hc, f'saldo_gestion{n}_al_salir') or 0)}
                for n in range(1, 5)
            ]
            saldo_total = sum(g['saldo'] for g in gestiones)

        # Saldo anterior = saldo_total del cargo previo (referencia de auditoría)
        saldo_anterior = 0.0
        if i > 0:
            prev = cargos[i - 1]
            saldo_anterior = prev['saldo_total']

        cargos.append({
            'cargo':          hc.cargo,
            'tipo_contrato':  hc.tipo_contrato,
            'fecha_inicio':   hc.fecha_inicio.strftime('%Y-%m-%d'),
            'fecha_fin':      hc.fecha_fin.strftime('%Y-%m-%d') if hc.fecha_fin else None,
            'es_actual':      hc.es_actual,
            'saldo_anterior': saldo_anterior,
            'saldo_total':    saldo_total,
            'gestiones':      gestiones,
        })

    # Etiqueta del rol para el PDF
    rol_label = 'ADMINISTRACIÓN'
    for rol in _ROL_PRIORIDAD:
        if rol in roles:
            rol_label = _ROL_LABEL[rol]
            break

    cargo_actual_hc = next((hc for hc in cargos_qs if hc.es_actual), None)

    return JsonResponse({
        'funcionario': {
            'cod_funcionario': f.cod_funcionario,
            'nombre_completo': f"{f.ci.nombre} {f.ci.ap_paterno} {f.ci.ap_materno or ''}".strip(),
            'ci':              f.ci.ci,
            'cargo_actual':    cargo_actual_hc.cargo if cargo_actual_hc else '—',
            'fecha_ingreso':   f.fecha_ingreso.strftime('%Y-%m-%d'),
        },
        'cargos':    cargos,
        'rol_label': rol_label,
    })
