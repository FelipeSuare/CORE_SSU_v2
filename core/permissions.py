"""
Matriz de permisos centralizada — fuente única de verdad del control de acceso SSU.
Para agregar o cambiar permisos editar SOLO este archivo.
"""

_F = frozenset  # alias


# ── Matriz: url_name → roles con acceso ──────────────────────────────────────

PERMISOS: dict[str, frozenset] = {
    # Gestión de empleados
    'funcionarios':     _F(['RRHH', 'Administrador']),
    'historial_cargos': _F(['Administrador', 'Auditoria']),

    # Core
    'feriados':         _F(['RRHH', 'Administrador']),

    # Vacaciones
    'vacaciones':       _F(['Funcionario', 'Administrador']),
    'solicitudes':      _F(['Funcionario', 'Administrador', 'Auditoria']),
    'aprobacion':       _F(['Administrador', 'Jefe de Area',
                            'Gerente Administrativo', 'Gerente de Salud', 'Gerente General']),
    'formulario_vac':   _F(['RRHH', 'Administrador']),
    'historial_rrhh':   _F(['RRHH', 'Administrador']),
    'anulacion':        _F(['RRHH', 'Administrador']),
    'solicitudes_rechazadas': _F(['RRHH', 'Administrador']),

    # Reportes
    'reporte_p':        _F(['RRHH', 'Administrador', 'Auditoria']),
    'reporte_g':        _F(['RRHH', 'Administrador', 'Auditoria']),
}

# URL names que no requieren restricción de rol (solo login_required)
URL_ABIERTAS: frozenset = _F([
    # Páginas
    'index', 'login_home', 'login', 'perfil', 'contrasena',
    # Foto de perfil
    'perfil_foto', 'perfil_foto_eliminar',
    # APIs compartidas
    'mi_perfil_api',
    'rp_unidades', 'rp_funcionarios', 'rp_historial',
    'vac_datos', 'vac_calcular_retorno', 'vac_crear',
    'vac_mis_solicitudes', 'vac_seguimiento',
    'vac_para_aprobar', 'vac_decision',
    'vac_historial_rrhh', 'vac_pdf',
    'feriados_lista',
    'funcionarios_lista', 'funcionarios_aprobadores', 'funcionarios_exportar',
    'funcionarios_buscar',
])

# Orden de prioridad de roles para la UI (el primero encontrado = rol principal)
PRIORIDAD_ROL: list[str] = [
    'Administrador', 'Gerente General', 'Gerente Administrativo',
    'Gerente de Salud', 'RRHH', 'Jefe de Area', 'Auditoria', 'Funcionario',
]


def puede_acceder(roles_usuario: set, url_name: str) -> bool:
    """True si alguno de los roles del usuario está autorizado para url_name."""
    if url_name in URL_ABIERTAS:
        return True
    if url_name not in PERMISOS:
        return True  # URL no registrada → no restringida por este sistema
    return bool(roles_usuario & PERMISOS[url_name])
