from datetime import date

from django.contrib.auth.models import User
from django.db import transaction, connection, IntegrityError
from django.db.models import Q
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import UnidadOrganizacional
from employees.models import Persona, Funcionario, HistorialCargo
from accounts.models import Roles, FuncionarioRol
from vacations.models import GestionVacacion, JerarquiaAprobacion

_NIVELES = {
    'PERSONAL DE AREA':      3,
    'JEFE AREA':             2,
    'DEPENDENCIA DIRECTA':   1,
    'GERENTE ADMINISTRATIVO':1,
    'GERENTE SALUD':         1,
    'GERENTE GENERAL':       0,
}

_ROLES_EMPLOYEES = frozenset({'RRHH', 'Administrador'})
_ROLES_HISTORIAL = frozenset({'Administrador', 'Auditoria'})

_ROL_LABEL = {
    'Administrador': 'ADMINISTRACIÓN',
    'Auditoria':     'AUDITORÍA',
}
_ROL_PRIORIDAD = ['Administrador', 'Auditoria']


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
        cargo_act = HistorialCargo.objects.filter(cod_funcionario=f).order_by('-fecha_inicio').first()
    roles = list(
        FuncionarioRol.objects.filter(cod_funcionario=f, activo=True)
        .values_list('id_roles__tipo_rol', flat=True)
    )
    jerarquia = [
        {
            'nivel':            j.nivel_aprobacion,
            'aprobador_cod':    j.cod_aprobador.cod_funcionario,
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
        'tipo_baja':        f.tipo_baja or '',
        'roles':            roles,
        'jerarquia':        jerarquia,
    }


class ListarFuncionariosView(APIView):
    def get(self, request):
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

        return Response({'funcionarios': resultado})


class AprobadoresView(APIView):
    def get(self, request):
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

        return Response({
            'jefes_area':      por_rol('Jefe de Area'),
            'gerentes':        por_rol('Gerente Administrativo') + por_rol('Gerente de Salud'),
            'gerente_general': por_rol('Gerente General'),
            'descripciones':   descripciones,
        })


class NuevoFuncionarioView(APIView):
    def post(self, request):
        data = request.data

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
            return Response(
                {'error': 'Todos los campos obligatorios deben completarse.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if Persona.objects.filter(ci=ci).exists():
            return Response(
                {'error': f'Ya existe un funcionario con CI {ci}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            fecha_nac = date.fromisoformat(fecha_nac_str)
            fecha_ing = date.fromisoformat(fecha_ing_str)
        except ValueError:
            return Response({'error': 'Formato de fecha inválido.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            unidad = UnidadOrganizacional.objects.get(nombre=unidad_nombre)
        except UnidadOrganizacional.DoesNotExist:
            return Response(
                {'error': f'Unidad "{unidad_nombre}" no encontrada.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

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

                from vacations.utils import poblar_gestion_vacacion
                poblar_gestion_vacacion(funcionario)

        except IntegrityError as e:
            return Response(
                {'error': f'Error de base de datos: {e}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response({'ok': True, 'cod': cod}, status=status.HTTP_201_CREATED)


class EditarFuncionarioView(APIView):
    def post(self, request, cod):
        try:
            funcionario = Funcionario.objects.select_related('ci', 'id_unidad').get(cod_funcionario=cod)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        data = request.data

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
            return Response(
                {'error': 'Todos los campos obligatorios deben completarse.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            fecha_nac = date.fromisoformat(fecha_nac_str)
            fecha_ing = date.fromisoformat(fecha_ing_str)
        except ValueError:
            return Response({'error': 'Formato de fecha inválido.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            unidad = UnidadOrganizacional.objects.get(nombre=unidad_nombre)
        except UnidadOrganizacional.DoesNotExist:
            return Response(
                {'error': f'Unidad "{unidad_nombre}" no encontrada.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
            return Response(
                {'error': f'Error de base de datos: {e}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response({'ok': True})


class ToggleEstadoView(APIView):
    def post(self, request, cod):
        try:
            f = Funcionario.objects.get(cod_funcionario=cod)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        data         = request.data
        nuevo_estado = 'INACTIVO' if f.estado == 'ACTIVO' else 'ACTIVO'

        if nuevo_estado == 'INACTIVO':
            fecha_baja_str = data.get('fecha_baja', '').strip()
            tipo_baja      = data.get('tipo_baja', '').strip()

            if not fecha_baja_str:
                return Response(
                    {'error': 'La fecha de baja es requerida.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if tipo_baja not in ('Despido', 'Renuncia', 'Muerte'):
                return Response(
                    {'error': 'El tipo de baja es requerido (Despido, Renuncia o Muerte).'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                fecha_baja = date.fromisoformat(fecha_baja_str)
            except ValueError:
                return Response({'error': 'Fecha de baja inválida.'}, status=status.HTTP_400_BAD_REQUEST)

            cargo_act = HistorialCargo.objects.filter(cod_funcionario=f, es_actual=True).first()
            if cargo_act:
                cargo_act.es_actual = False
                cargo_act.save(update_fields=['es_actual'])

            f.fecha_baja = fecha_baja
            f.tipo_baja  = tipo_baja
            f.estado     = nuevo_estado
            f.save(update_fields=['estado', 'fecha_baja', 'tipo_baja'])
        else:
            # Reactivar
            fecha_ingreso_str = data.get('fecha_ingreso', '').strip()

            # Re-activar el último cargo registrado
            cargo_reciente = HistorialCargo.objects.filter(
                cod_funcionario=f
            ).order_by('-fecha_inicio').first()
            if cargo_reciente and not cargo_reciente.es_actual:
                cargo_reciente.es_actual = True
                cargo_reciente.save(update_fields=['es_actual'])

            campos = ['estado', 'fecha_baja', 'tipo_baja']
            f.fecha_baja = None
            f.tipo_baja  = None
            f.estado     = nuevo_estado

            if fecha_ingreso_str:
                try:
                    f.fecha_ingreso = date.fromisoformat(fecha_ingreso_str)
                    campos.append('fecha_ingreso')
                except ValueError:
                    pass

            f.save(update_fields=campos)

        return Response({'ok': True, 'estado': f.estado})


class BuscarFuncionariosView(APIView):
    def get(self, request):
        q = request.GET.get('q', '').strip()
        if len(q) < 2:
            return Response({'funcionarios': []})

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

        return Response({'funcionarios': resultado})


class HistorialCargosView(APIView):
    def get(self, request, cod):
        from core.roles import obtener_roles

        roles = obtener_roles(request.user.username)
        if not (roles & _ROLES_HISTORIAL):
            return Response({'error': 'No autorizado'}, status=status.HTTP_403_FORBIDDEN)

        try:
            f = Funcionario.objects.select_related('ci').get(cod_funcionario=cod)
        except Funcionario.DoesNotExist:
            return Response({'error': 'Funcionario no encontrado'}, status=status.HTTP_404_NOT_FOUND)

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

            saldo_anterior = cargos[i - 1]['saldo_total'] if i > 0 else 0.0

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

        rol_label = 'ADMINISTRACIÓN'
        for rol in _ROL_PRIORIDAD:
            if rol in roles:
                rol_label = _ROL_LABEL[rol]
                break

        cargo_actual_hc = next((hc for hc in cargos_qs if hc.es_actual), None)

        return Response({
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


_ROLES_PDF_BAJA = frozenset({'RRHH', 'Administrador'})


def _generar_pdf_vacaciones_baja(f, gv, cargo):
    import os
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=1.5*cm, bottomMargin=1.5*cm,
    )
    W = A4[0] - 4*cm

    p = f.ci
    HDR_RED  = colors.HexColor('#F2949C')
    BLACK    = colors.black
    WHITE    = colors.white
    GRAY     = colors.HexColor('#000000')

    def sty(fname, fsize, align=TA_LEFT, color=BLACK, leading=None):
        return ParagraphStyle(
            f'{fname}_{fsize}_{align}_{id(color)}',
            fontName=fname, fontSize=fsize,
            alignment=align,
            leading=leading or (fsize + 2),
            textColor=color,
        )

    sTitle  = sty('Helvetica-Bold', 12, TA_CENTER)
    sLabel  = sty('Helvetica-Bold',  8)
    sVal    = sty('Helvetica',       8)
    sBCtr   = sty('Helvetica-Bold',  8, TA_CENTER)
    sSmall  = sty('Helvetica',       7)
    sSmallB = sty('Helvetica-Bold',  7)
    sSection = sty('Helvetica-Bold', 8, TA_CENTER, BLACK)

    def P(txt, style): return Paragraph(str(txt), style)

    HDR_TS = TableStyle([
        ('BACKGROUND',    (0, 0), (-1, -1), HDR_RED),
        ('BOX',           (0, 0), (-1, -1), 0.5, BLACK),
        ('TOPPADDING',    (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING',   (0, 0), (-1, -1), 6),
        ('TEXTCOLOR',     (0, 0), (-1, -1), WHITE),
        ('ALIGN',         (0, 0), (-1, -1), 'CENTER'),
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

    logo_path = os.path.normpath(
        os.path.join(os.path.dirname(__file__), '..', 'static', 'img', 'login', 'LOGOSSU.png')
    )

    elements = []
    elements.append(P('<u><b>INFORME DE SALDO DE VACACIONES AL CIERRE</b></u>', sTitle))
    elements.append(Spacer(1, 0.2*cm))

    nombre_completo = f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip()
    wL = W * 0.65
    wR = W * 0.35
    wLa = wL * 0.38
    wLb = wL * 0.62

    logo_cell = (
        Image(logo_path, width=5*cm, height=5*cm)
        if os.path.exists(logo_path) else P('', sVal)
    )

    hdr_datos = Table([
        [P('DATOS DEL FUNCIONARIO', sSection), '', logo_cell],
        [P('Carnet:', sLabel),                P(p.ci, sVal),                ''],
        [P('Nombre Completo:', sLabel),        P(nombre_completo, sVal),     ''],
        [P('Unidad Organizacional:', sLabel),  P(f.id_unidad.nombre if f.id_unidad else '—', sVal), ''],
        [P('Cargo:', sLabel),                  P(cargo.cargo if cargo else '—', sVal), ''],
        [P('Fecha de Ingreso:', sLabel),       P(f.fecha_ingreso.strftime('%d/%m/%Y') if f.fecha_ingreso else '—', sVal), ''],
    ], colWidths=[wLa, wLb, wR])

    hdr_datos.setStyle(TableStyle([
        ('BOX',           (0, 0), (-1, -1), 0.5, BLACK),
        ('INNERGRID',     (0, 0), (-1, -1), 0.25, GRAY),
        ('TOPPADDING',    (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING',   (0, 0), (-1, -1), 6),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ('SPAN',          (0, 0), (1, 0)),
        ('BACKGROUND',    (0, 0), (1, 0), HDR_RED),
        ('TEXTCOLOR',     (0, 0), (1, 0), WHITE),
        ('ALIGN',         (0, 0), (1, 0), 'CENTER'),
        ('SPAN',          (2, 0), (2, 5)),
        ('ALIGN',         (2, 0), (2, 5), 'CENTER'),
        ('VALIGN',        (2, 0), (2, 5), 'MIDDLE'),
        ('BACKGROUND',    (2, 0), (2, 5), WHITE),
        ('LINEAFTER',     (1, 0), (1, 5), 0.5, BLACK),
    ]))
    elements.append(hdr_datos)
    elements.append(Spacer(1, 0.15*cm))

    elements.append(section_hdr('DATOS DE LA BAJA'))
    w2 = W / 2
    t_baja = Table([
        [P('Fecha de Baja:', sLabel), P(f.fecha_baja.strftime('%d/%m/%Y') if f.fecha_baja else '—', sVal),
         P('Tipo de Baja:', sLabel),  P(f.tipo_baja or '—', sVal)],
    ], colWidths=[w2 * 0.35, w2 * 0.65, w2 * 0.35, w2 * 0.65])
    t_baja.setStyle(DATA_TS)
    elements.append(t_baja)
    elements.append(Spacer(1, 0.15*cm))

    elements.append(section_hdr('SALDO DE VACACIONES AL MOMENTO DE LA BAJA'))

    def gest_row(n):
        if gv:
            anio = getattr(gv, f'anio_gestion{n}')
            dias = float(getattr(gv, f'dias_gestion{n}') or 0)
            label = f'Gestión {anio}:' if anio else f'Gestión {n}:'
            return label, f'{dias:.1f} días'
        return f'Gestión {n}:', '0.0 días'

    g = [gest_row(n) for n in range(1, 5)]
    total = f'{float(gv.dias_adeudados or 0):.1f}' if gv else '0.0'

    wa, wb = W * 0.40, W * 0.60
    rows_gest = [[P(label, sLabel), P(val, sVal)] for label, val in g if val != '0.0 días' or True]
    rows_gest.append([P('TOTAL ADEUDADO:', sLabel), P(f'{total} días', sSmallB)])

    t_gest = Table(rows_gest, colWidths=[wa, wb])
    t_gest.setStyle(DATA_TS)
    elements.append(t_gest)
    elements.append(Spacer(1, 0.3*cm))

    fecha_imp = date.today().strftime('%d/%m/%Y')
    t_nota = Table([[
        P('Este documento certifica el saldo de vacaciones acumuladas al momento del cierre laboral del funcionario.', sSmall),
        P(f'<b>Fecha de impresión:</b> {fecha_imp}', sSmallB),
    ]], colWidths=[W * 0.68, W * 0.32])
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


class VacacionesBajaPDFView(APIView):
    def get(self, request, cod):
        from django.http import HttpResponse as DjangoHttpResponse

        ci = request.user.username
        try:
            user_func = Funcionario.objects.get(ci__ci=ci, estado='ACTIVO')
        except Funcionario.DoesNotExist:
            return Response({'error': 'No autorizado.'}, status=status.HTTP_403_FORBIDDEN)

        roles = set(
            FuncionarioRol.objects.filter(cod_funcionario=user_func, activo=True)
            .values_list('id_roles__tipo_rol', flat=True)
        )
        if not (roles & _ROLES_PDF_BAJA):
            return Response({'error': 'Sin permiso para generar este reporte.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            f = Funcionario.objects.select_related('ci', 'id_unidad').get(
                cod_funcionario=cod, estado='INACTIVO'
            )
        except Funcionario.DoesNotExist:
            return Response(
                {'error': 'Funcionario inactivo no encontrado.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        gv    = GestionVacacion.objects.filter(cod_funcionario=f).first()
        cargo = HistorialCargo.objects.filter(cod_funcionario=f).order_by('-fecha_inicio').first()

        pdf_bytes = _generar_pdf_vacaciones_baja(f, gv, cargo)

        p      = f.ci
        nombre = f"{p.nombre}_{p.ap_paterno}".replace(' ', '_')
        response = DjangoHttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="Vacaciones_Baja_{nombre}.pdf"'
        return response
