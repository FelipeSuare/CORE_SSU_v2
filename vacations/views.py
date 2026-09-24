from datetime import date
from decimal import Decimal
from io import BytesIO

from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.shortcuts import render

from employees.models import Funcionario, HistorialCargo
from accounts.models import FuncionarioRol
from vacations.models import (
    AnulacionAjuste, AprobacionSolicitud, GestionVacacion,
    JerarquiaAprobacion,
)

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


def _generar_pdf_solicitud(solicitud):
    import os
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from django.db.models import Sum as _Sum

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=1.5*cm, bottomMargin=1.5*cm,
    )
    W = A4[0] - 4*cm

    f    = solicitud.cod_funcionario
    p    = f.ci
    tipo = f.tipo_funcionario
    fs   = solicitud.fecha_solicitud

    cargo_act = HistorialCargo.objects.filter(cod_funcionario=f, es_actual=True).first()
    try:
        gv = GestionVacacion.objects.get(cod_funcionario=f)
    except GestionVacacion.DoesNotExist:
        gv = None

    ya_ajustados_pdf = AnulacionAjuste.objects.filter(
        id_formulario=solicitud, tipo_anulacion='AJUSTE'
    ).aggregate(total=_Sum('dias_devolver'))['total'] or Decimal('0')
    dias_efectivos_pdf = solicitud.dias_solicitados - ya_ajustados_pdf

    # Solo aprobadores ACTIVOS (estado='ACTIVO') que cubran la fecha de solicitud.
    # - cod_aprobador__estado='ACTIVO' descarta personas despedidas/renunciadas aunque
    #   su registro JerarquiaAprobacion no haya sido cerrado correctamente.
    # - fecha_fin__gt=fs (strict) evita que el registro del día del despido siga apareciendo.
    aprobadores = {}
    for n in range(1, 4):
        ja = JerarquiaAprobacion.objects.filter(
            cod_funcionario=f, nivel_aprobacion=n,
            fecha_inicio__lte=fs,
            cod_aprobador__estado='ACTIVO',
        ).filter(
            Q(fecha_fin__isnull=True) | Q(fecha_fin__gt=fs)
        ).select_related('cod_aprobador__ci').first()
        if ja:
            aprobadores[n] = ja.cod_aprobador

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

    HDR_RED  = colors.HexColor('#F2949C')
    COD_PINK = colors.HexColor('#F2949C')
    GRAY     = colors.HexColor("#000000")
    BLACK    = colors.black
    WHITE    = colors.white

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

    logo_path = os.path.normpath(
        os.path.join(os.path.dirname(__file__), '..', 'static', 'img', 'login', 'LOGOSSU.png')
    )
    logo_cell = (
        Image(logo_path, width=6*cm, height=6*cm)
        if os.path.exists(logo_path) else P('', sVal)
    )

    elements = []

    elements.append(P('<u><b>FORMULARIO DE SOLICITUD VACACIÓN</b></u>', sTitle))
    elements.append(Spacer(1, 0.2*cm))

    cod_sol = f"G{solicitud.id_formulario:03d}"
    nombre_completo = f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip()

    wL = W * 0.65
    wR = W * 0.35
    wLa = wL * 0.38
    wLb = wL * 0.62

    hdr_datos = Table([
        [P(f'Cod. Solicitud / {cod_sol}', sCod), '', logo_cell],
        [P('DATOS DEL EMPLEADO', sSection), '', ''],
        [P('Carnet:', sLabel),                P(p.ci, sVal),                ''],
        [P('Nombre Completo:', sLabel),        P(nombre_completo, sVal),     ''],
        [P('Unidad Organizacional:', sLabel),  P(f.id_unidad.nombre if f.id_unidad else '—', sVal), ''],
        [P('Cargo:', sLabel),                  P(cargo_act.cargo if cargo_act else '—', sVal), ''],
        [P('Fecha Nominal:', sLabel),          P(f.fecha_ingreso.strftime('%d/%m/%Y') if f.fecha_ingreso else '—', sVal), ''],
    ], colWidths=[wLa, wLb, wR])

    hdr_datos.setStyle(TableStyle([
        ('BOX',           (0, 0), (-1, -1), 0.5, BLACK),
        ('INNERGRID',     (0, 0), (-1, -1), 0.25, GRAY),
        ('TOPPADDING',    (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING',   (0, 0), (-1, -1), 6),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ('SPAN',          (0, 0), (1, 0)),
        ('BACKGROUND',    (0, 0), (1, 0), COD_PINK),
        ('SPAN',          (0, 1), (1, 1)),
        ('BACKGROUND',    (0, 1), (1, 1), HDR_RED),
        ('TEXTCOLOR',     (0, 1), (1, 1), WHITE),
        ('ALIGN',         (0, 1), (1, 1), 'CENTER'),
        ('SPAN',          (2, 0), (2, 6)),
        ('ALIGN',         (2, 0), (2, 6), 'CENTER'),
        ('VALIGN',        (2, 0), (2, 6), 'MIDDLE'),
        ('BACKGROUND',    (2, 0), (2, 6), WHITE),
        ('LINEAFTER',     (1, 0), (1, 6), 0.5, BLACK),
    ]))
    elements.append(hdr_datos)
    elements.append(Spacer(1, 0.15*cm))

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

    elements.append(section_hdr("VACACIONES AUTORIZADAS POR"))

    # Detectar si al momento de la solicitud no había Jefe de Área asignado.
    # Después de redirigir_jerarquia_por_baja_jefe, el DB tiene nivel 1=Gerente Adm/Salud,
    # nivel 2=Gerente General para PERSONAL DE AREA, por eso los niveles de firma se reasignan.
    # Considera que no hay Jefe de Área si: el aprobador de nivel 1 está INACTIVO (despedido/renunciado)
    # o si directamente no existe ningún Jefe de Área activo en ese nivel para esa fecha.
    sin_jefe_area_pdf = (
        tipo == 'PERSONAL DE AREA' and
        not JerarquiaAprobacion.objects.filter(
            cod_funcionario=f,
            nivel_aprobacion=1,
            fecha_inicio__lte=fs,
            cod_aprobador__tipo_funcionario='JEFE AREA',
            cod_aprobador__estado='ACTIVO',
        ).filter(
            Q(fecha_fin__isnull=True) | Q(fecha_fin__gt=fs)
        ).exists()
    )

    if sin_jefe_area_pdf and tipo == 'PERSONAL DE AREA':
        # nivel_db=None → celda vacía; DB nivel 1 y 2 pasan a posiciones 2 y 3
        firmas = [
            ('Firma Jefe de Área\n(No asignado)', None),
            ('Firma de Gerente de\nSalud o Administrativo', 1),
            ('Firma de Gerente General', 2),
        ]
    else:
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
        fw = W / n if n else W
        row_info   = []
        row_labels = []
        for label, nivel in firmas:
            if nivel is None:
                # Nivel sin asignación histórica — celda vacía con texto indicativo
                info_txt = '<font color="#aaaaaa"><i>Sin asignación</i></font>'
            else:
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
            [P('', sVal)] * n,
            row_info,
            row_labels,
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

    wh = W / 2

    func_info = f'<b>{nombre_completo}</b><br/><font size="6">Cód: {f.cod_funcionario}</font>'

    if rrhh_fr:
        rrhh_full = f"{rrhh_fr.cod_funcionario.ci.nombre} {rrhh_fr.cod_funcionario.ci.ap_paterno} {rrhh_fr.cod_funcionario.ci.ap_materno or ''}".strip()
        rrhh_cod  = rrhh_fr.cod_funcionario.cod_funcionario
        rrhh_info = f'<b>{rrhh_full}</b><br/><font size="6">Cód: {rrhh_cod}</font>'
    else:
        rrhh_info = ''

    t_fin = Table([
        [P('', sVal), P('', sVal)],
        [P(func_info, sCenter), P(rrhh_info, sCenter)],
        [P('Firma funcionario', sBCenter),
         P('Firma del Jefe de Recursos Humanos', sBCenter)],
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
#  VISTAS DE TEMPLATE
# ══════════════════════════════════════════════════════════════════════════════

@login_required(login_url='login_home')
def vacaciones_view(request):
    return render(request, 'vacations/Vacaciones.html')


@login_required(login_url='login_home')
def historial_solicitudes_view(request):
    return render(request, 'vacations/Historial_Solicitudes.html')


@login_required(login_url='login_home')
def aprobacion_view(request):
    return render(request, 'vacations/Aprobación_Rechazo.html')


@login_required(login_url='login_home')
def historial_rrhh_view(request):
    tiene_acceso, _ = _check_acceso_historial(request)
    if not tiene_acceso:
        return render(request, 'shared/sin_acceso.html', status=403)
    return render(request, 'vacations/Frm_Solicitud.html')


@login_required(login_url='login_home')
def anulacion_view(request):
    tiene_acceso, _ = _check_acceso_historial(request)
    if not tiene_acceso:
        return render(request, 'shared/sin_acceso.html', status=403)
    return render(request, 'vacations/Anulación.html')


def _generar_pdf_rechazada(solicitud, apr_rechazo):
    import os
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

    f  = solicitud.cod_funcionario
    p  = f.ci
    fs = solicitud.fecha_solicitud

    cargo_act = HistorialCargo.objects.filter(cod_funcionario=f, es_actual=True).first()

    HDR_RED = colors.HexColor('#F2949C')
    ERR_RED = colors.HexColor('#c62828')
    BLACK   = colors.black
    WHITE   = colors.white
    GRAY    = colors.HexColor('#000000')

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
    sCenter  = sty('Helvetica',       8, TA_CENTER)
    sBCenter = sty('Helvetica-Bold',  8, TA_CENTER)
    sSmall   = sty('Helvetica',       7)
    sSmallB  = sty('Helvetica-Bold',  7)
    sErr     = sty('Helvetica-Bold',  9, TA_CENTER, ERR_RED)

    def P(txt, style): return Paragraph(str(txt), style)

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

    def section_hdr(text, bg=HDR_RED):
        ts = TableStyle([
            ('BACKGROUND',    (0, 0), (-1, -1), bg),
            ('BOX',           (0, 0), (-1, -1), 0.5, BLACK),
            ('TOPPADDING',    (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING',   (0, 0), (-1, -1), 6),
        ])
        sty_text = sty('Helvetica-Bold', 8, TA_CENTER, WHITE if bg == ERR_RED else BLACK)
        t = Table([[P(text, sty_text)]], colWidths=[W])
        t.setStyle(ts)
        return t

    logo_path = os.path.normpath(
        os.path.join(os.path.dirname(__file__), '..', 'static', 'img', 'login', 'LOGOSSU.png')
    )
    logo_cell = (
        Image(logo_path, width=5.5*cm, height=5.5*cm)
        if os.path.exists(logo_path) else P('', sVal)
    )

    elements = []
    elements.append(P('<u><b>FORMULARIO DE SOLICITUD VACACIÓN — RECHAZADA</b></u>', sTitle))
    elements.append(Spacer(1, 0.2*cm))

    cod_sol          = f"G{solicitud.id_formulario:03d}"
    nombre_completo  = f"{p.nombre} {p.ap_paterno} {p.ap_materno or ''}".strip()

    wL = W * 0.65; wR = W * 0.35
    wLa = wL * 0.38; wLb = wL * 0.62

    hdr_datos = Table([
        [P(f'Cod. Solicitud / {cod_sol}', sCod), '', logo_cell],
        [P('DATOS DEL EMPLEADO', sSection), '', ''],
        [P('Carnet:', sLabel),               P(p.ci, sVal),                                          ''],
        [P('Nombre Completo:', sLabel),       P(nombre_completo, sVal),                              ''],
        [P('Unidad Organizacional:', sLabel), P(f.id_unidad.nombre if f.id_unidad else '—', sVal),   ''],
        [P('Cargo:', sLabel),                 P(cargo_act.cargo if cargo_act else '—', sVal),         ''],
        [P('Fecha Nominal:', sLabel),         P(f.fecha_ingreso.strftime('%d/%m/%Y') if f.fecha_ingreso else '—', sVal), ''],
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
        ('SPAN',          (0, 1), (1, 1)),
        ('BACKGROUND',    (0, 1), (1, 1), HDR_RED),
        ('ALIGN',         (0, 1), (1, 1), 'CENTER'),
        ('SPAN',          (2, 0), (2, 6)),
        ('ALIGN',         (2, 0), (2, 6), 'CENTER'),
        ('VALIGN',        (2, 0), (2, 6), 'MIDDLE'),
        ('BACKGROUND',    (2, 0), (2, 6), WHITE),
        ('LINEAFTER',     (1, 0), (1, 6), 0.5, BLACK),
    ]))
    elements.append(hdr_datos)
    elements.append(Spacer(1, 0.15*cm))

    elements.append(section_hdr('PERÍODO DE VACACIONES SOLICITADO'))
    w4 = W / 4
    t_periodo = Table([
        [P('Fecha Solicitud:', sLabel), P(fs.strftime('%d/%m/%Y'), sVal),
         P('Días Solicitados:', sLabel), P(str(float(solicitud.dias_solicitados)), sVal)],
        [P('Fecha Inicio:', sLabel),    P(solicitud.fecha_salida.strftime('%d/%m/%Y'), sVal),
         P('Fecha Final:', sLabel),     P(solicitud.fecha_retorno.strftime('%d/%m/%Y'), sVal)],
        [P('Descripción:', sLabel),     P(solicitud.motivo_vacacion or '—', sVal), '', ''],
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

    elements.append(section_hdr('DECISIÓN DE RECHAZO', bg=ERR_RED))

    if apr_rechazo:
        from vacations.models import JerarquiaAprobacion as _JA
        nivel_label = f'Nivel {apr_rechazo.nivel}'
        try:
            ja = _JA.objects.filter(
                cod_funcionario=f,
                nivel_aprobacion=apr_rechazo.nivel,
            ).order_by('-fecha_inicio').first()
            if ja:
                tipo = ja.cod_aprobador.tipo_funcionario
                nivel_label = {
                    'JEFE AREA': 'Jefe de Área',
                    'GERENTE ADMINISTRATIVO': 'Gerente Administrativo',
                    'GERENTE SALUD': 'Gerente de Salud',
                    'GERENTE GENERAL': 'Gerente General',
                }.get(tipo, nivel_label)
        except Exception:
            pass

        apr_p = apr_rechazo.cod_aprobador.ci
        nombre_apr = f"{apr_p.nombre} {apr_p.ap_paterno} {apr_p.ap_materno or ''}".strip()
        fecha_apr  = apr_rechazo.fecha_decision.strftime('%d/%m/%Y')
        obs        = apr_rechazo.observacion or '—'

        w2 = W / 2
        t_rechazo = Table([
            [P('Nivel de Rechazo:', sLabel),  P(nivel_label, sVal),
             P('Fecha de Rechazo:', sLabel),  P(fecha_apr, sVal)],
            [P('Rechazado por:', sLabel),      P(nombre_apr, sVal), '', ''],
            [P('Motivo del Rechazo:', sLabel), P(obs, sVal),        '', ''],
        ], colWidths=[w2 * 0.3, w2 * 0.7, w2 * 0.3, w2 * 0.7])
        t_rechazo.setStyle(TableStyle([
            ('BOX',           (0, 0), (-1, -1), 0.5, BLACK),
            ('INNERGRID',     (0, 0), (-1, -1), 0.25, GRAY),
            ('TOPPADDING',    (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING',   (0, 0), (-1, -1), 6),
            ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
            ('SPAN',          (1, 1), (3, 1)),
            ('SPAN',          (1, 2), (3, 2)),
        ]))
        elements.append(t_rechazo)
    else:
        t_nd = Table([[P('Sin información de rechazo registrada.', sCenter)]], colWidths=[W])
        t_nd.setStyle(DATA_TS)
        elements.append(t_nd)

    elements.append(Spacer(1, 0.25*cm))
    fecha_imp = date.today().strftime('%d/%m/%Y')
    t_nota = Table([[
        P('Este documento certifica que la solicitud fue rechazada en el proceso de aprobación.', sSmall),
        P(f'<b>Fecha:</b> {fecha_imp}', sSmallB),
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


@login_required(login_url='login_home')
def rechazadas_view(request):
    tiene_acceso, _ = _check_acceso_historial(request)
    if not tiene_acceso:
        return render(request, 'shared/sin_acceso.html', status=403)
    return render(request, 'vacations/Solicitudes_Rechazadas.html')


@login_required(login_url='login_home')
def acuerdos_view(request):
    tiene_acceso, _ = _check_acceso_historial(request)
    if not tiene_acceso:
        return render(request, 'shared/sin_acceso.html', status=403)
    return render(request, 'vacations/Acuerdos_Vacacion.html')
