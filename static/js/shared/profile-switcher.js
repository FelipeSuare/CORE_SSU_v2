// ═══════════════════════════════════════════════════════════════════════════
//  PROFILE SWITCHER — lógica compartida entre todos los módulos SSU
//
//  IDs fijos en el HTML (iguales en todos los módulos):
//    btnProfile          → botón disparador
//    currentProfileText  → <span> con rol activo dentro del botón
//    profilePanel        → panel desplegable
//    profileNamePanel    → <span> con nombre abreviado dentro del panel
//    currentRolePanel    → <span> con rol activo dentro del panel
//    roleList            → <ul> donde se insertan los <li class="role-item">
// ═══════════════════════════════════════════════════════════════════════════

// ── Módulo "hogar" de cada rol ────────────────────────────────────────────
window.ROLE_DESTINATIONS = {
    'Funcionario':            '/Vacaciones.html',
    'Administrador':          '/Aprobacion.html',
    'RRHH':                   '/Anulacion.html',
    'Auditoría':              null,
    'Jefe de Area':           '/Aprobacion.html',
    'Gerente Administrativo': '/Aprobacion.html',
    'Gerente de Salud':       '/Aprobacion.html',
    'Gerente General':        '/Aprobacion.html',
};

// ── Icono Material Symbols por rol ────────────────────────────────────────
window.ROLE_ICONS = {
    'Funcionario':            'person',
    'Administrador':          'settings',
    'RRHH':                   'groups',
    'Auditoría':              'manage_search',
    'Jefe de Area':           'school',
    'Gerente Administrativo': 'work',
    'Gerente de Salud':       'favorite',
    'Gerente General':        'workspace_premium',
};

// ── Roles preferidos por módulo ───────────────────────────────────────────
const _MODULO_ROLES = {
    '/Vacaciones.html':    ['Funcionario'],
    '/Solicitudes.html':   ['Funcionario'],
    '/Aprobacion.html':    ['Gerente General', 'Gerente Administrativo', 'Gerente de Salud', 'Jefe de Area', 'Administrador'],
    '/Anulacion.html':     ['RRHH', 'Administrador'],
    '/FormularioVac.html': ['Administrador', 'RRHH', 'Funcionario'],
    '/Feriados.html':      ['Administrador', 'RRHH'],
};

/**
 * Retorna la URL de destino para un rol desde la página actual.
 * Si ya estamos en ese módulo devuelve null (no hay redirección).
 */
window.profileSwitcherGetRedirect = function (rol) {
    const dest = window.ROLE_DESTINATIONS[rol];
    if (!dest) return null;
    return window.location.pathname.replace(/\/$/, '') === dest.replace(/\/$/, '')
        ? null
        : dest;
};

/**
 * Detecta el rol más relevante para la página actual.
 */
window.detectarRolActual = function (roles) {
    const path = window.location.pathname;
    const preferidos = _MODULO_ROLES[path] || ['Funcionario'];
    return preferidos.find(r => roles.includes(r)) || roles[0] || 'Funcionario';
};

/**
 * Inicializa el panel de perfil (diseño Vacaciones).
 * Usa IDs fijos: btnProfile, currentProfileText, profilePanel,
 *                profileNamePanel, currentRolePanel, roleList.
 *
 * @param {object} cfg
 *   cfg.roles    - array de tipo_rol desde BD
 *   cfg.nombre   - nombre completo del usuario
 *   cfg.rolActual - (opcional) rol a marcar como activo; si null se auto-detecta
 */
window.initProfileSwitcher = function ({ roles = [], nombre = '', rolActual = null }) {
    const activo = rolActual || window.detectarRolActual(roles);

    const nameEl  = document.getElementById('profileNamePanel');
    const roleEl  = document.getElementById('currentRolePanel');
    const btnText = document.getElementById('currentProfileText');
    const listEl  = document.getElementById('roleList');

    if (nameEl)  nameEl.textContent  = _abreviar(nombre);
    if (roleEl)  roleEl.textContent  = activo;
    if (btnText) btnText.textContent = activo;

    if (!listEl) return;
    listEl.innerHTML = '';

    // Funcionario siempre primero, luego el resto en orden alfabético
    const ordenados = [...roles].sort((a, b) => {
        if (a === 'Funcionario') return -1;
        if (b === 'Funcionario') return  1;
        return a.localeCompare(b, 'es');
    });

    ordenados.forEach(rol => {
        const icon     = window.ROLE_ICONS[rol] || 'badge';
        const redirect = window.profileSwitcherGetRedirect(rol);
        const esActivo = rol === activo;

        const li = document.createElement('li');
        li.className = 'role-item' + (esActivo ? ' active-role' : '');
        li.setAttribute('data-rol', rol);
        li.innerHTML = `
            <i class="material-symbols-outlined">${icon}</i>
            <span>${rol}</span>
            <i class="material-symbols-outlined role-check">check</i>`;

        li.addEventListener('click', e => {
            e.stopPropagation();
            const panel = document.getElementById('profilePanel');
            if (panel) panel.classList.remove('show');

            if (redirect) {
                window.location.href = redirect;
                return;
            }
            // Mismo módulo: actualizar visual
            const btnT = document.getElementById('currentProfileText');
            const rolEl = document.getElementById('currentRolePanel');
            if (btnT)  btnT.textContent  = rol;
            if (rolEl) rolEl.textContent = rol;
            listEl.querySelectorAll('.role-item').forEach(item =>
                item.classList.toggle('active-role', item.getAttribute('data-rol') === rol)
            );
        });

        listEl.appendChild(li);
    });
};

/**
 * Configura el toggle del panel de perfil (abrir/cerrar).
 * Usa IDs fijos: btnProfile y profilePanel.
 */
window.setupProfileToggle = function () {
    const btn   = document.getElementById('btnProfile');
    const panel = document.getElementById('profilePanel');
    if (!btn || !panel) return;

    btn.addEventListener('click', e => {
        e.stopPropagation();
        panel.classList.toggle('show');
    });

    document.addEventListener('click', e => {
        if (!document.querySelector('.profile-switcher-container')?.contains(e.target)) {
            panel.classList.remove('show');
        }
    });
};

// ── Helper interno ────────────────────────────────────────────────────────
function _abreviar(nombre) {
    const p = (nombre || '').split(' ').filter(Boolean);
    return p.length >= 2 ? `${p[0]} ${p[1][0]}.` : (p[0] || '—');
}
