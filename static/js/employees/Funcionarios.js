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
let tabActual        = 'ACTIVO';
let editandoCod      = null;
let aprobadoresCache = null;
let _debounceTimer   = null;
let _bajaCod         = null;

const formOverlay = document.getElementById('formOverlay');
const formPanel   = document.getElementById('formPanel');

// ═══════════════════════════════════════════════════════════════
//  Inicialización
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    cargarTabla();
    cargarPerfil();

    const input = document.getElementById('searchInput');
    input.addEventListener('input',   () => mostrarSugerencias());
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { cerrarDropdown(); filtrarTabla(); }
        if (e.key === 'Escape') cerrarDropdown();
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('.search-box')) cerrarDropdown();
    });
});

async function cargarPerfil() {
    try {
        const resp = await fetch('/api/usuario/mi-perfil/');
        const data = await resp.json();
        if (!data.error) {
            window.initProfileSwitcher?.({ roles: data.roles, nombre: data.nombre_completo });
            window.setupProfileToggle?.();
        }
    } catch (e) {
        console.error('Error cargando perfil:', e);
    }
}

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
    const esInactivo = tabActual === 'INACTIVO';
    tbody.innerHTML = lista.map(f => {
        const rolesExtra = f.roles.filter(r => r !== 'Funcionario');
        const fechaFmt   = f.fecha_ingreso ? f.fecha_ingreso.split('-').reverse().join('/') : '-';
        const col5 = esInactivo
            ? (f.fecha_baja
                ? `<span style="font-weight:600;color:var(--color-pink-dark)">${f.fecha_baja.split('-').reverse().join('/')}</span>`
                : '<span style="color:#bbb;font-size:.85em">—</span>')
            : `<span class="antiguedad-badge">${f.antiguedad}</span>`;
        return `
        <tr>
            <td style="font-weight:700;color:var(--color-pink-dark)">${f.ci}</td>
            <td>
                <div style="font-weight:700;color:var(--color-purple-dark)">${f.nombre} ${f.ap_paterno} ${f.ap_materno}</div>
                <div style="font-size:0.82em;color:rgba(114,0,53,.75);margin-top:3px">${f.cargo}</div>
            </td>
            <td>${f.unidad || '-'}</td>
            <td>${fechaFmt}</td>
            <td>${col5}</td>
            <td>${etiquetaTipo(f.tipo_funcionario)}</td>
            <td>${rolesExtra.length ? generarBadgesRoles(rolesExtra) : '<span style="color:#bbb;font-size:.85em">—</span>'}</td>
            <td style="white-space:nowrap">
                <button class="action-btn action-btn-edit"   onclick="abrirEditar('${f.cod}')" title="Editar">
                    <i class="material-symbols-outlined">edit</i>
                </button>
                <button class="action-btn action-btn-toggle" onclick="cambiarEstado('${f.cod}','${f.estado}')"
                        title="${f.estado === 'ACTIVO' ? 'Dar de baja' : 'Reactivar'}">
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
    const th = document.getElementById('thAntiguedadBaja');
    if (th) th.innerHTML = tabActual === 'INACTIVO' ? 'FECHA DE<br>BAJA' : 'ANTIGÜEDAD';
    cargarTabla();
}

// ═══════════════════════════════════════════════════════════════
//  Búsqueda con autocompletado
// ═══════════════════════════════════════════════════════════════
function filtrarTabla() {
    const q = document.getElementById('searchInput').value.trim();
    cerrarDropdown();
    cargarTabla(q);
}

function cerrarDropdown() {
    document.getElementById('sugerenciasDropdown').style.display = 'none';
}

function mostrarSugerencias() {
    clearTimeout(_debounceTimer);
    const texto = document.getElementById('searchInput').value.trim();
    if (texto.length < 2) { cerrarDropdown(); return; }
    _debounceTimer = setTimeout(() => _fetchSugerencias(texto), 250);
}

async function _fetchSugerencias(texto) {
    const dropdown = document.getElementById('sugerenciasDropdown');
    try {
        const resp = await fetch(`/funcionarios/buscar/?q=${encodeURIComponent(texto)}`);
        const data = await resp.json();
        const hits = data.funcionarios || [];

        if (!hits.length) {
            dropdown.innerHTML = `
                <div class="sug-item sug-empty">
                    <i class="material-symbols-outlined">person_off</i> No se encontró funcionario
                </div>`;
        } else {
            dropdown.innerHTML = hits.map(f => `
                <div class="sug-item" onclick="seleccionarSugerencia('${_escHtml(f.nombre_completo)}')">
                    <i class="material-symbols-outlined sug-icon">person</i>
                    <div>
                        <div class="sug-nombre">${_resaltar(_escHtml(f.nombre_completo), texto)}</div>
                        <div class="sug-ci">C.I. ${_resaltar(_escHtml(f.ci), texto)}</div>
                    </div>
                </div>`).join('');
        }
        dropdown.style.display = 'block';
    } catch (err) {
        console.error('Error autocompletado:', err);
    }
}

function seleccionarSugerencia(nombreCompleto) {
    document.getElementById('searchInput').value = nombreCompleto;
    cerrarDropdown();
    cargarTabla(nombreCompleto);
}

function _resaltar(html, q) {
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return html.replace(
        new RegExp(`(${safe})`, 'gi'),
        `<mark style="background:rgba(114,0,53,0.12);color:rgb(114,0,53);font-weight:800;border-radius:2px;padding:0 2px">$1</mark>`
    );
}

function _escHtml(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════
//  Toggle estado / Baja con fecha
// ═══════════════════════════════════════════════════════════════
async function cambiarEstado(cod, estadoActual) {
    if (estadoActual === 'ACTIVO') {
        abrirModalBaja(cod);
    } else {
        const confirmar = await AppDialog.confirm(
            '¿Reactivar a este funcionario?',
            { title: 'Reactivar', icon: 'person_check', confirmText: 'Sí', cancelText: 'No' }
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
}

function abrirModalBaja(cod) {
    _bajaCod = cod;
    const hoy = new Date().toISOString().split('T')[0];
    const input = document.getElementById('fechaBaja');
    input.value = hoy;
    input.max   = hoy;
    const overlay = document.getElementById('bajaOverlay');
    const panel   = document.getElementById('bajaPanel');
    overlay.style.display = 'flex';
    setTimeout(() => { overlay.classList.add('active'); panel.classList.add('active'); }, 10);
}

function cerrarModalBaja() {
    const overlay = document.getElementById('bajaOverlay');
    const panel   = document.getElementById('bajaPanel');
    panel.classList.remove('active');
    setTimeout(() => {
        overlay.classList.remove('active');
        setTimeout(() => { overlay.style.display = 'none'; _bajaCod = null; }, 300);
    }, 300);
}

async function confirmarBaja() {
    const fechaBaja = document.getElementById('fechaBaja').value;
    if (!fechaBaja) {
        AppDialog.alert('Debe ingresar una fecha de baja.', { title: 'Campo requerido', icon: 'warning' });
        return;
    }
    cerrarModalBaja();
    try {
        const resp = await fetch(estadoUrl(_bajaCod), {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
            body:    JSON.stringify({ fecha_baja: fechaBaja }),
        });
        const data = await resp.json();
        if (!resp.ok) { AppDialog.alert(data.error, { title: 'Error', icon: 'error' }); return; }
        cargarTabla();
        AppDialog.alert('Funcionario dado de baja correctamente.', { title: 'Baja registrada', icon: 'check_circle', variant: 'success' });
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
    document.getElementById('codFuncionario').value = '';
    document.getElementById('matriculaSeguro').value = '';
    limpiarRoles();
    document.getElementById('grupoBaja').style.display = 'none';
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
    document.getElementById('codFuncionario').value  = f.cod;
    document.getElementById('matriculaSeguro').value = f.matricula_seguro || '';
    document.getElementById('cargo').value           = f.cargo;
    // Mostrar fecha de baja solo para personal inactivo
    const grupoBaja = document.getElementById('grupoBaja');
    const inputBaja = document.getElementById('fechaBajaInfo');
    if (f.estado === 'INACTIVO' && f.fecha_baja) {
        inputBaja.value = f.fecha_baja.split('-').reverse().join('/');
        grupoBaja.style.display = '';
    } else {
        grupoBaja.style.display = 'none';
    }
    const tcSelect = document.getElementById('tipoContrato');
    tcSelect.value = f.tipo_contrato;
    if (tcSelect.value !== f.tipo_contrato && f.tipo_contrato) {
        const opt = document.createElement('option');
        opt.value = f.tipo_contrato;
        opt.textContent = f.tipo_contrato;
        tcSelect.appendChild(opt);
        tcSelect.value = f.tipo_contrato;
    }
    document.getElementById('unidad').value          = f.unidad;
    document.getElementById('fechaIngreso').value    = f.fecha_ingreso;
    document.getElementById('tipoFuncionario').value = f.tipo_funcionario;
    cargarRoles(f.roles);

    formOverlay.style.display = 'flex';
    setTimeout(() => { formOverlay.classList.add('active'); formPanel.classList.add('active'); }, 10);

    await actualizarJerarquia();

    // Pre-rellenar aprobadores actuales (nivel DB → select físico según tipo)
    setTimeout(() => {
        const map = _NIVEL_A_SEL[f.tipo_funcionario] || {};
        f.jerarquia.forEach(j => {
            const selId = map[j.nivel];
            const s = selId ? document.getElementById(selId) : null;
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
        case 'GERENTE GENERAL':
            seccionGG.style.display = 'block';
            marcarRol('rolGerGeneral');
            break;

        case 'GERENTE ADMINISTRATIVO':
            seccion.style.display = 'block';
            infoDiv.innerHTML = `<i class="material-symbols-outlined">info</i> <strong>1 nivel:</strong> Gerente General.`;
            grid.innerHTML = campo('Nivel 1 — Gerente General', 'Gerente General', 'workspace_premium', 'aprobadorN3', 3);
            marcarRol('rolGerAdm');
            break;

        case 'GERENTE SALUD':
            seccion.style.display = 'block';
            infoDiv.innerHTML = `<i class="material-symbols-outlined">info</i> <strong>1 nivel:</strong> Gerente General.`;
            grid.innerHTML = campo('Nivel 1 — Gerente General', 'Gerente General', 'workspace_premium', 'aprobadorN3', 3);
            marcarRol('rolGerSalud');
            break;

        case 'DEPENDENCIA DIRECTA':
            seccion.style.display = 'block';
            infoDiv.innerHTML = `<i class="material-symbols-outlined">info</i> <strong>1 nivel:</strong> Gerente General.`;
            grid.innerHTML = campo('Nivel 1 — Gerente General', 'Gerente General', 'workspace_premium', 'aprobadorN3', 3);
            break;

        case 'JEFE AREA':
            seccion.style.display = 'block';
            infoDiv.innerHTML = `<i class="material-symbols-outlined">info</i> <strong>2 niveles:</strong> Gerente → Gerente General.`;
            grid.innerHTML =
                campo('Nivel 1 — Gerente', 'Gerente Administrativo', 'work', 'aprobadorN2', 2) +
                campo('Nivel 2 — Gerente General', 'Gerente General', 'workspace_premium', 'aprobadorN3', 3);
            marcarRol('rolJefeArea');
            break;

        case 'PERSONAL DE AREA':
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

// Mapeo de nivel DB (secuencial desde 1) → id del select en el DOM, por tipo de funcionario.
// Los niveles en BD son siempre 1..N; el select físico refleja el rol del aprobador.
const _NIVEL_A_SEL = {
    'PERSONAL DE AREA':      { 1: 'aprobadorN1', 2: 'aprobadorN2', 3: 'aprobadorN3' },
    'JEFE AREA':             { 1: 'aprobadorN2', 2: 'aprobadorN3' },
    'GERENTE ADMINISTRATIVO':{ 1: 'aprobadorN3' },
    'GERENTE SALUD':         { 1: 'aprobadorN3' },
    'DEPENDENCIA DIRECTA':   { 1: 'aprobadorN3' },
};

function leerJerarquia() {
    const tipo = document.getElementById('tipoFuncionario').value;
    const jerarquia = [];
    const map = _NIVEL_A_SEL[tipo] || {};
    for (const [nivel, selId] of Object.entries(map)) {
        const el = document.getElementById(selId);
        const cod = el ? el.value.trim() : '';
        if (cod) jerarquia.push({ nivel: parseInt(nivel, 10), aprobador_cod: cod });
    }
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
        matricula_seguro: document.getElementById('matriculaSeguro').value.trim(),
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
        'PERSONAL DE AREA':      { label: 'Personal de Área',  color: 'rgba(39,20,71,.7)' },
        'JEFE AREA':             { label: 'Jefe de Área',      color: 'rgb(114,0,53)' },
        'DEPENDENCIA DIRECTA':   { label: 'Dep. Directa',      color: '#666' },
        'GERENTE ADMINISTRATIVO':{ label: 'Ger. Adm.',         color: '#1a5c2a' },
        'GERENTE SALUD':         { label: 'Ger. Salud',        color: '#0a4b7c' },
        'GERENTE GENERAL':       { label: 'Gerente General',   color: '#6b0000' },
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
