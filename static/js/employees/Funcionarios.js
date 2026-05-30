// ═══════════════════════════════════════════════════════════════
//  Configuración desde meta-tags
// ═══════════════════════════════════════════════════════════════
const m = n => document.querySelector(`meta[name="${n}"]`).content;
const CSRF           = m('csrf-token');
const URL_LISTA      = m('url-lista');
const URL_APROBADORES = m('url-aprobadores');
const URL_NUEVO      = m('url-nuevo');
const URL_EXPORTAR   = m('url-exportar');
const URL_BASE       = m('url-base-funcionario');

const editarUrl  = cod => `${URL_BASE}${cod}/editar/`;
const estadoUrl  = cod => `${URL_BASE}${cod}/estado/`;

// ═══════════════════════════════════════════════════════════════
//  Estado global
// ═══════════════════════════════════════════════════════════════
let tabActual    = 'ACTIVO';
let editandoCod  = null;
let aprobadoresCache = null;

const formOverlay = document.getElementById('formOverlay');
const formPanel   = document.getElementById('formPanel');

// ═══════════════════════════════════════════════════════════════
//  Inicialización
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    cargarTabla();
    document.getElementById('searchInput').addEventListener('keyup', e => {
        if (e.key === 'Enter') filtrarTabla();
    });
});

// ═══════════════════════════════════════════════════════════════
//  Tabla
// ═══════════════════════════════════════════════════════════════
async function cargarTabla(q = '') {
    const url = `${URL_LISTA}?estado=${tabActual}&q=${encodeURIComponent(q)}`;
    try {
        const resp = await fetch(url, { headers: { 'X-CSRFToken': CSRF } });
        const data = await resp.json();
        renderizarTabla(data.funcionarios || []);
        actualizarContadores();
    } catch {
        AppDialog.alert('Error al cargar los funcionarios.', { title: 'Error', icon: 'wifi_off' });
    }
}

async function actualizarContadores() {
    try {
        const [ra, ri] = await Promise.all([
            fetch(`${URL_LISTA}?estado=ACTIVO`,   { headers: { 'X-CSRFToken': CSRF } }),
            fetch(`${URL_LISTA}?estado=INACTIVO`, { headers: { 'X-CSRFToken': CSRF } }),
        ]);
        const da = await ra.json();
        const di = await ri.json();
        document.getElementById('countActivo').textContent   = da.funcionarios.length;
        document.getElementById('countInactivo').textContent = di.funcionarios.length;
    } catch { /* silencioso */ }
}

function renderizarTabla(lista) {
    const tbody = document.getElementById('funcionariosBody');
    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:#aaa">No hay funcionarios registrados</td></tr>`;
        return;
    }
    tbody.innerHTML = lista.map(f => {
        const rolesExtra = f.roles.filter(r => r !== 'Funcionario');
        const fechaFmt   = f.fecha_ingreso ? f.fecha_ingreso.split('-').reverse().join('/') : '-';
        return `
        <tr>
            <td style="font-weight:700;color:var(--color-pink-dark)">${f.ci}</td>
            <td>
                <div style="font-weight:700;color:var(--color-purple-dark)">${f.nombre} ${f.ap_paterno} ${f.ap_materno}</div>
                <div style="font-size:0.82em;color:rgba(114,0,53,.75);margin-top:3px">${f.cargo}</div>
            </td>
            <td>${f.unidad || '-'}</td>
            <td>${fechaFmt}</td>
            <td><span class="antiguedad-badge">${f.antiguedad}</span></td>
            <td>${etiquetaTipo(f.tipo_funcionario)}</td>
            <td>${rolesExtra.length ? generarBadgesRoles(rolesExtra) : '<span style="color:#bbb;font-size:.85em">—</span>'}</td>
            <td style="white-space:nowrap">
                <button class="action-btn action-btn-edit"   onclick="abrirEditar('${f.cod}')" title="Editar">
                    <i class="material-symbols-outlined">edit</i>
                </button>
                <button class="action-btn action-btn-toggle" onclick="cambiarEstado('${f.cod}')"
                        title="${f.estado === 'ACTIVO' ? 'Desactivar' : 'Activar'}">
                    <i class="material-symbols-outlined">power_settings_new</i>
                </button>
            </td>
        </tr>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════
//  Tabs
// ═══════════════════════════════════════════════════════════════
function cambiarTab(estado) {
    tabActual = estado === 'activo' ? 'ACTIVO' : 'INACTIVO';
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    event.currentTarget.classList.add('active');
    cargarTabla();
}

// ═══════════════════════════════════════════════════════════════
//  Búsqueda
// ═══════════════════════════════════════════════════════════════
function filtrarTabla() {
    const q = document.getElementById('searchInput').value.trim();
    cargarTabla(q);
}

// ═══════════════════════════════════════════════════════════════
//  Toggle estado
// ═══════════════════════════════════════════════════════════════
async function cambiarEstado(cod) {
    const confirmar = await AppDialog.confirm(
        '¿Cambiar el estado de este funcionario?',
        { title: 'Confirmar', icon: 'power_settings_new', confirmText: 'Sí', cancelText: 'No' }
    );
    if (!confirmar) return;
    try {
        const resp = await fetch(estadoUrl(cod), {
            method: 'POST', headers: { 'X-CSRFToken': CSRF },
        });
        const data = await resp.json();
        if (!resp.ok) { AppDialog.alert(data.error, { title: 'Error', icon: 'error' }); return; }
        cargarTabla();
    } catch {
        AppDialog.alert('Error de conexión.', { title: 'Error', icon: 'wifi_off' });
    }
}

// ═══════════════════════════════════════════════════════════════
//  Exportar — modal de filtros
// ═══════════════════════════════════════════════════════════════
function exportarDatos() {
    const overlay = document.getElementById('exportOverlay');
    const panel   = document.getElementById('exportPanel');
    overlay.style.display = 'flex';
    setTimeout(() => { overlay.classList.add('active'); panel.classList.add('active'); }, 10);
}

function cerrarModalExportar() {
    const overlay = document.getElementById('exportOverlay');
    const panel   = document.getElementById('exportPanel');
    panel.classList.remove('active');
    setTimeout(() => {
        overlay.classList.remove('active');
        setTimeout(() => { overlay.style.display = 'none'; }, 300);
    }, 300);
}

function confirmarExportar() {
    const unidad = document.getElementById('exportUnidad').value;
    const estado = document.getElementById('exportEstado').value;
    const cargo  = document.getElementById('exportCargo').value.trim();

    const params = new URLSearchParams();
    if (unidad) params.set('unidad', unidad);
    if (estado) params.set('estado', estado);
    if (cargo)  params.set('cargo',  cargo);

    const url = params.toString() ? `${URL_EXPORTAR}?${params}` : URL_EXPORTAR;
    window.open(url, '_blank');
    cerrarModalExportar();
}

// ═══════════════════════════════════════════════════════════════
//  Modal — abrir / cerrar
// ═══════════════════════════════════════════════════════════════
async function mostrarFormulario() {
    editandoCod = null;
    aprobadoresCache = null;
    document.getElementById('formTitle').textContent = 'Registrar Funcionario';
    document.getElementById('funcionarioForm').reset();
    limpiarRoles();
    document.getElementById('sectionJerarquia').style.display    = 'none';
    document.getElementById('sectionGerenteGeneral').style.display = 'none';
    document.getElementById('gridJerarquia').innerHTML = '';
    formOverlay.style.display = 'flex';
    setTimeout(() => { formOverlay.classList.add('active'); formPanel.classList.add('active'); }, 10);
}

async function abrirEditar(cod) {
    editandoCod = cod;
    aprobadoresCache = null;
    document.getElementById('formTitle').textContent = 'Editar Funcionario';

    const url = `${URL_LISTA}?estado=ACTIVO&q=`;
    // Buscar en activos e inactivos
    let f = null;
    for (const est of ['ACTIVO', 'INACTIVO']) {
        const resp = await fetch(`${URL_LISTA}?estado=${est}`, { headers: { 'X-CSRFToken': CSRF } });
        const data = await resp.json();
        f = data.funcionarios.find(x => x.cod === cod);
        if (f) break;
    }
    if (!f) { AppDialog.alert('Funcionario no encontrado.'); return; }

    document.getElementById('ci').value              = f.ci;
    document.getElementById('ci').readOnly           = true;
    document.getElementById('nombres').value         = f.nombre;
    document.getElementById('apellidoPaterno').value = f.ap_paterno;
    document.getElementById('apellidoMaterno').value = f.ap_materno;
    document.getElementById('fechaNacimiento').value = f.fecha_nacimiento;
    document.getElementById('sexo').value            = f.sexo;
    document.getElementById('cargo').value           = f.cargo;
    document.getElementById('tipoContrato').value    = f.tipo_contrato;
    document.getElementById('unidad').value          = f.unidad;
    document.getElementById('fechaIngreso').value    = f.fecha_ingreso;
    document.getElementById('tipoFuncionario').value = f.tipo_funcionario;
    cargarRoles(f.roles);

    formOverlay.style.display = 'flex';
    setTimeout(() => { formOverlay.classList.add('active'); formPanel.classList.add('active'); }, 10);

    await actualizarJerarquia();

    // Pre-rellenar aprobadores actuales
    setTimeout(() => {
        f.jerarquia.forEach(j => {
            const s  = document.getElementById(`aprobadorN${j.nivel}`);
            if (s) s.value = j.aprobador_cod;
        });
    }, 80);
}

function cancelarFormulario() {
    formPanel.classList.remove('active');
    setTimeout(() => {
        formOverlay.classList.remove('active');
        setTimeout(() => {
            formOverlay.style.display = 'none';
            editandoCod = null;
            document.getElementById('ci').readOnly = false;
        }, 300);
    }, 300);
}

// ═══════════════════════════════════════════════════════════════
//  Jerarquía dinámica (carga aprobadores desde API)
// ═══════════════════════════════════════════════════════════════
async function actualizarJerarquia() {
    const tipo      = document.getElementById('tipoFuncionario').value;
    const seccion   = document.getElementById('sectionJerarquia');
    const seccionGG = document.getElementById('sectionGerenteGeneral');
    const infoDiv   = document.getElementById('infoJerarquia');
    const grid      = document.getElementById('gridJerarquia');

    seccion.style.display   = 'none';
    seccionGG.style.display = 'none';
    grid.innerHTML = '';
    if (!tipo) return;

    if (!aprobadoresCache) {
        const excluir = editandoCod ? `?excluir=${editandoCod}` : '';
        const resp = await fetch(URL_APROBADORES + excluir, { headers: { 'X-CSRFToken': CSRF } });
        aprobadoresCache = await resp.json();
    }

    const { jefes_area, gerentes, gerente_general, descripciones } = aprobadoresCache;

    function opts(lista, ph) {
        return `<option value="">${ph}</option>` +
            lista.map(f => `<option value="${f.cod}">${f.nombre} — ${f.cargo}</option>`).join('');
    }

    function campo(labelBase, rolKey, icono, selId, niv) {
        const desc = descripciones[rolKey] || labelBase;
        return `
        <div class="form-group form-group-full">
            <label id="lbl_${selId}">${labelBase}
                <span style="font-weight:400;color:#666;font-size:.85em" id="desc_${selId}"></span>
            </label>
            <div class="input-wrapper">
                <i class="material-symbols-outlined input-icon">${icono}</i>
                <select id="${selId}" onchange="mostrarDescripcionRol('${selId}','${rolKey}')">
                    ${opts(
                        niv === 1 ? jefes_area
                        : niv === 2 ? gerentes
                        : gerente_general,
                        `Seleccionar...`
                    )}
                </select>
            </div>
        </div>`;
    }

    switch (tipo) {
        case 'GERENTE_GENERAL':
            seccionGG.style.display = 'block';
            marcarRol('rolGerGeneral');
            break;

        case 'GERENTE_ADMINISTRATIVO':
            seccion.style.display = 'block';
            infoDiv.innerHTML = `<i class="material-symbols-outlined">info</i> <strong>1 nivel:</strong> Gerente General.`;
            grid.innerHTML = campo('Nivel 1 — Gerente General', 'Gerente General', 'workspace_premium', 'aprobadorN3', 3);
            marcarRol('rolGerAdm');
            break;

        case 'GERENTE_SALUD':
            seccion.style.display = 'block';
            infoDiv.innerHTML = `<i class="material-symbols-outlined">info</i> <strong>1 nivel:</strong> Gerente General.`;
            grid.innerHTML = campo('Nivel 1 — Gerente General', 'Gerente General', 'workspace_premium', 'aprobadorN3', 3);
            marcarRol('rolGerSalud');
            break;

        case 'DEPENDENCIA_DIRECTA':
            seccion.style.display = 'block';
            infoDiv.innerHTML = `<i class="material-symbols-outlined">info</i> <strong>1 nivel:</strong> Gerente General.`;
            grid.innerHTML = campo('Nivel 1 — Gerente General', 'Gerente General', 'workspace_premium', 'aprobadorN3', 3);
            break;

        case 'JEFE_AREA':
            seccion.style.display = 'block';
            infoDiv.innerHTML = `<i class="material-symbols-outlined">info</i> <strong>2 niveles:</strong> Gerente → Gerente General.`;
            grid.innerHTML =
                campo('Nivel 1 — Gerente', 'Gerente Administrativo', 'work', 'aprobadorN2', 2) +
                campo('Nivel 2 — Gerente General', 'Gerente General', 'workspace_premium', 'aprobadorN3', 3);
            marcarRol('rolJefeArea');
            break;

        case 'SUBORDINADO':
            seccion.style.display = 'block';
            infoDiv.innerHTML = `<i class="material-symbols-outlined">info</i> <strong>3 niveles:</strong> Jefe de Área → Gerente → Gerente General.`;
            grid.innerHTML =
                campo('Nivel 1 — Jefe de Área',    'Jefe de Area',  'school',            'aprobadorN1', 1) +
                campo('Nivel 2 — Gerente',          'Gerente Administrativo', 'work',     'aprobadorN2', 2) +
                campo('Nivel 3 — Gerente General',  'Gerente General', 'workspace_premium','aprobadorN3', 3);
            break;
    }
}

function mostrarDescripcionRol(selId, rolKey) {
    const sel  = document.getElementById(selId);
    const desc = document.getElementById(`desc_${selId}`);
    if (!desc || !aprobadoresCache) return;
    if (sel.value) {
        desc.textContent = `— ${aprobadoresCache.descripciones[rolKey] || ''}`;
    } else {
        desc.textContent = '';
    }
}

function marcarRol(cbId) {
    const cb = document.getElementById(cbId);
    if (cb) cb.checked = true;
}

function leerJerarquia() {
    const tipo = document.getElementById('tipoFuncionario').value;
    const jerarquia = [];
    const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

    const push = (nivel, selId) => {
        const cod = val(selId);
        if (cod) jerarquia.push({ nivel, aprobador_cod: cod });
    };

    if      (tipo === 'SUBORDINADO')  { push(1,'aprobadorN1'); push(2,'aprobadorN2'); push(3,'aprobadorN3'); }
    else if (tipo === 'JEFE_AREA')    { push(2,'aprobadorN2'); push(3,'aprobadorN3'); }
    else if (['GERENTE_ADMINISTRATIVO','GERENTE_SALUD','DEPENDENCIA_DIRECTA'].includes(tipo))
                                      { push(3,'aprobadorN3'); }
    return jerarquia;
}

// ═══════════════════════════════════════════════════════════════
//  Roles helpers
// ═══════════════════════════════════════════════════════════════
function obtenerRolesSeleccionados() {
    const roles = ['Funcionario'];
    const ids = ['rolAdmin','rolRRHH','rolAuditoria','rolJefeArea','rolGerAdm','rolGerSalud','rolGerGeneral'];
    ids.forEach(id => {
        const cb = document.getElementById(id);
        if (cb && cb.checked) roles.push(cb.value);
    });
    return [...new Set(roles)];
}

function cargarRoles(roles) {
    limpiarRoles();
    if (!roles) return;
    const map = {
        'Administrador':          'rolAdmin',
        'RRHH':                   'rolRRHH',
        'Auditoria':              'rolAuditoria',
        'Jefe de Area':           'rolJefeArea',
        'Gerente Administrativo': 'rolGerAdm',
        'Gerente de Salud':       'rolGerSalud',
        'Gerente General':        'rolGerGeneral',
    };
    Object.entries(map).forEach(([rol, id]) => {
        const cb = document.getElementById(id);
        if (cb) cb.checked = roles.includes(rol);
    });
}

function limpiarRoles() {
    document.querySelectorAll('.roles-selector input[type="checkbox"]').forEach(cb => {
        cb.checked = cb.id === 'rolFuncionario';
    });
}

// ═══════════════════════════════════════════════════════════════
//  Submit del formulario
// ═══════════════════════════════════════════════════════════════
document.getElementById('funcionarioForm').addEventListener('submit', async e => {
    e.preventDefault();
    const tipo = document.getElementById('tipoFuncionario').value;
    if (!tipo) { AppDialog.alert('Seleccione el tipo de funcionario.', { title: 'Campo requerido', icon: 'warning' }); return; }

    const payload = {
        ci:               document.getElementById('ci').value.trim(),
        nombres:          document.getElementById('nombres').value.trim(),
        ap_paterno:       document.getElementById('apellidoPaterno').value.trim(),
        ap_materno:       document.getElementById('apellidoMaterno').value.trim(),
        fecha_nacimiento: document.getElementById('fechaNacimiento').value,
        sexo:             document.getElementById('sexo').value,
        cargo:            document.getElementById('cargo').value.trim(),
        tipo_contrato:    document.getElementById('tipoContrato').value,
        unidad:           document.getElementById('unidad').value,
        fecha_ingreso:    document.getElementById('fechaIngreso').value,
        tipo_funcionario: tipo,
        roles:            obtenerRolesSeleccionados(),
        jerarquia:        leerJerarquia(),
    };

    const url    = editandoCod ? editarUrl(editandoCod) : URL_NUEVO;
    const btnSave = document.querySelector('#funcionarioForm button[type="submit"]');
    btnSave.disabled = true;

    try {
        const resp = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
            body:    JSON.stringify(payload),
        });
        const data = await resp.json();
        if (!resp.ok) {
            AppDialog.alert(data.error || 'Error al guardar.', { title: 'Error', icon: 'error' });
            return;
        }
        cancelarFormulario();
        cargarTabla();
        AppDialog.alert(
            editandoCod ? 'Funcionario actualizado correctamente.' : 'Funcionario registrado correctamente.',
            { title: 'Guardado', icon: 'check_circle', variant: 'success' }
        );
    } catch {
        AppDialog.alert('Error de conexión.', { title: 'Error', icon: 'wifi_off' });
    } finally {
        btnSave.disabled = false;
    }
});

// ═══════════════════════════════════════════════════════════════
//  Badges y etiquetas
// ═══════════════════════════════════════════════════════════════
function etiquetaTipo(tipo) {
    const map = {
        SUBORDINADO:            { label: 'Subordinado',      color: 'rgba(39,20,71,.7)' },
        JEFE_AREA:              { label: 'Jefe de Área',     color: 'rgb(114,0,53)' },
        DEPENDENCIA_DIRECTA:    { label: 'Dep. Directa',     color: '#666' },
        GERENTE_ADMINISTRATIVO: { label: 'Ger. Adm.',        color: '#1a5c2a' },
        GERENTE_SALUD:          { label: 'Ger. Salud',       color: '#0a4b7c' },
        GERENTE_GENERAL:        { label: 'Gerente General',  color: '#6b0000' },
    };
    const t = map[tipo] || { label: tipo, color: '#555' };
    return `<span class="role-badge-mini" style="background:${t.color}">${t.label}</span>`;
}

const ROLE_ICONS = {
    'Funcionario': 'person', 'Administrador': 'settings', 'RRHH': 'groups',
    'Auditoria': 'search', 'Jefe de Area': 'school',
    'Gerente Administrativo': 'work', 'Gerente de Salud': 'add_circle',
    'Gerente General': 'workspace_premium',
};

function generarBadgesRoles(roles) {
    return `<div class="roles-badges">${roles.map(r =>
        `<span class="role-badge-mini" style="background:rgba(114,0,53,.75);font-size:.7em">
            <i class="material-symbols-outlined" style="margin-right:3px">${ROLE_ICONS[r]||'person'}</i>${r}
        </span>`
    ).join('')}</div>`;
}
