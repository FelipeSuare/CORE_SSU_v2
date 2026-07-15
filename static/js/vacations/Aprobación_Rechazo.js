// ══════════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ══════════════════════════════════════════════════════════════
const CSRF_TOKEN       = document.querySelector('meta[name="csrf-token"]').content;
const URL_SOLICITUDES  = '/api/vacaciones/para-aprobar/';
const URL_DECISION     = '/api/vacaciones/decision/';

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ══════════════════════════════════════════════════════════════
//  ESTADO DEL MÓDULO
// ══════════════════════════════════════════════════════════════
let todasLasSolicitudes = [];
let solicitudesFiltradas = [];
let solicitudSeleccionada = null;
let accionSeleccionada = null;   // 'aprobar' | 'rechazar'

// ══════════════════════════════════════════════════════════════
//  ELEMENTOS DOM
// ══════════════════════════════════════════════════════════════
const nombreUsuarioSpan    = document.getElementById('nombreUsuario');
const rolUsuarioSpan       = document.getElementById('rolUsuario');
const solicitudesTableBody = document.getElementById('solicitudesTableBody');
const countPendientes      = document.getElementById('countPendientes');
const countAprobadas       = document.getElementById('countAprobadas');
const modalAprobacion      = document.getElementById('modalAprobacion');
const modalConfirmacion    = document.getElementById('modalConfirmacion');
const flujoAprobacion      = document.getElementById('flujoAprobacion');
const comentariosTextarea  = document.getElementById('comentarios');
const btnAprobar           = document.getElementById('btnAprobar');
const btnRechazar          = document.getElementById('btnRechazar');
const btnConfirmarAprobacion = document.getElementById('btnConfirmarAprobacion');
const btnConfirmarRechazo    = document.getElementById('btnConfirmarRechazo');

// ══════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    await cargarSolicitudes();
    registrarEventListeners();
});

// ══════════════════════════════════════════════════════════════
//  CARGA DESDE BACKEND
// ══════════════════════════════════════════════════════════════
async function cargarSolicitudes() {
    try {
        const resp = await fetch(URL_SOLICITUDES, { headers: { 'X-CSRFToken': CSRF_TOKEN } });
        const data = await resp.json();

        if (data.error) {
            AppDialog.alert(data.error);
            return;
        }

        // Actualizar panel de usuario y roles dinámicos
        if (data.aprobador) {
            renderizarRoles(
                data.aprobador.roles || [],
                data.aprobador.nombre,
                data.aprobador.rol
            );
        }

        todasLasSolicitudes = data.solicitudes || [];
        solicitudesFiltradas = [...todasLasSolicitudes];

        countPendientes.textContent = data.contadores?.pendientes ?? 0;
        countAprobadas.textContent  = data.contadores?.aprobadas  ?? 0;

        renderizarTabla();

    } catch (err) {
        console.error('Error al cargar solicitudes:', err);
        AppDialog.alert('Error al cargar las solicitudes. Verifique su conexión.');
    }
}

// ══════════════════════════════════════════════════════════════
//  FILTROS
// ══════════════════════════════════════════════════════════════
function filtrarSolicitudes() {
    const q          = document.getElementById('funcionarioFilter').value.toLowerCase().trim();
    const fechaDesde = document.getElementById('fechaDesde').value;

    solicitudesFiltradas = todasLasSolicitudes.filter(sol => {
        const matchQ     = !q || sol.funcionario.toLowerCase().includes(q);
        const matchFecha = !fechaDesde || sol.fecha_solicitud >= fechaDesde;
        return matchQ && matchFecha;
    });

    renderizarTabla();
}

function limpiarFiltros() {
    document.getElementById('funcionarioFilter').value = '';
    document.getElementById('fechaDesde').value = '';
    solicitudesFiltradas = [...todasLasSolicitudes];
    renderizarTabla();
}

// ══════════════════════════════════════════════════════════════
//  RENDERIZADO DE TABLA
// ══════════════════════════════════════════════════════════════
function renderizarTabla() {
    solicitudesTableBody.innerHTML = '';

    if (solicitudesFiltradas.length === 0) {
        solicitudesTableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center;padding:24px;color:#aaa">
                    No se encontraron solicitudes con los criterios especificados.
                </td>
            </tr>`;
        return;
    }

    solicitudesFiltradas.forEach(sol => {
        const accionBtn = sol.puede_actuar
            ? `<button class="btn-review" onclick="abrirModalRevision(${sol.id})">
                    <i class="material-symbols-outlined">visibility</i>
               </button>`
            : '<span style="color:#bbb;font-size:0.82em">No disponible</span>';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td data-label="Funcionario">${esc(sol.funcionario)}</td>
            <td data-label="Cargo">${esc(sol.cargo)}</td>
            <td data-label="Fecha Solicitud">${formatearFecha(sol.fecha_solicitud)}</td>
            <td data-label="Período Vacacional">
                ${formatearFecha(sol.fecha_salida)} – ${formatearFecha(sol.fecha_retorno)}
            </td>
            <td data-label="Días">${sol.dias}</td>
            <td data-label="Estado">${badgeEstado(sol.estado_display)}</td>
            <td data-label="Flujo">${flujoCompacto(sol.flujo)}</td>
            <td data-label="Acción">${accionBtn}</td>
        `;
        solicitudesTableBody.appendChild(row);
    });
}

function badgeEstado(estado) {
    const mapa = {
        Pendiente: 'badge-pendiente-jefe',
        Aprobada:  'badge-aprobada',
        Rechazada: 'badge-rechazada',
    };
    return `<span class="badge ${mapa[estado] || 'badge-pendiente-jefe'}">${estado}</span>`;
}

function flujoCompacto(flujo) {
    if (!flujo || flujo.length === 0) return '—';
    const partes = [];
    flujo.forEach((paso, i) => {
        let icon, color;
        if (paso.decision === 'APROBADO') {
            icon = 'check_circle'; color = '#388e3c';
        } else if (paso.decision === 'RECHAZADO') {
            icon = 'cancel'; color = '#d32f2f';
        } else {
            const prevApproved = i === 0 || (flujo[i - 1]?.decision === 'APROBADO');
            if (prevApproved) { icon = 'schedule'; color = '#f57c00'; }
            else              { icon = 'lock';     color = '#9e9e9e'; }
        }
        partes.push(
            `<span style="color:${color}"><i class="material-symbols-outlined">${icon}</i></span>`
        );
        if (i < flujo.length - 1) {
            partes.push(
                `<i class="material-symbols-outlined" style="color:#ddd;font-size:0.8em">arrow_forward</i>`
            );
        }
    });
    return `<span style="display:flex;align-items:center;gap:6px;font-size:1.05em">${partes.join('')}</span>`;
}

// ══════════════════════════════════════════════════════════════
//  MODAL DE REVISIÓN
// ══════════════════════════════════════════════════════════════
function abrirModalRevision(id) {
    solicitudSeleccionada =
        solicitudesFiltradas.find(s => s.id === id) ||
        todasLasSolicitudes.find(s => s.id === id);

    if (!solicitudSeleccionada) return;

    const s = solicitudSeleccionada;
    document.getElementById('modalFuncionario').textContent    = s.funcionario;
    document.getElementById('modalCargo').textContent          = s.cargo;
    document.getElementById('modalUnidad').textContent         = s.unidad;
    document.getElementById('modalContrato').textContent       = s.tipo_contrato;
    document.getElementById('modalFechaSolicitud').textContent = formatearFecha(s.fecha_solicitud);
    document.getElementById('modalFechaInicio').textContent    = formatearFecha(s.fecha_salida);
    document.getElementById('modalFechaFinal').textContent     = formatearFecha(s.fecha_retorno);
    document.getElementById('modalDias').textContent           = `${s.dias} días`;
    document.getElementById('modalSaldo').textContent          = `${s.saldo_antes} días`;
    document.getElementById('modalSaldoDespues').textContent   = `${s.saldo_despues} días`;
    document.getElementById('modalObservaciones').textContent  = s.motivo || 'Sin observaciones';

    flujoAprobacion.innerHTML = flujoDetallado(s.flujo);
    limpiarDecision();
    modalAprobacion.classList.add('show');
}

function cerrarModalAprobacion() {
    modalAprobacion.classList.remove('show');
    solicitudSeleccionada = null;
}

function flujoDetallado(flujo) {
    if (!flujo || flujo.length === 0) return '<p>Sin niveles de aprobación definidos.</p>';

    return flujo.map((paso, i) => {
        let estado, icon;
        if (paso.decision === 'APROBADO') {
            estado = 'approved'; icon = 'check';
        } else if (paso.decision === 'RECHAZADO') {
            estado = 'rejected'; icon = 'close';
        } else {
            const prevApproved = i === 0 || flujo[i - 1]?.decision === 'APROBADO';
            if (prevApproved) { estado = 'pending';  icon = 'hourglass_empty'; }
            else              { estado = 'inactive'; icon = 'lock'; }
        }

        const fechaHtml = paso.fecha
            ? `<div class="flow-date">${formatearFecha(paso.fecha)}</div>`
            : '';
        const arrow = i < flujo.length - 1
            ? '<div class="flow-arrow"><i class="material-symbols-outlined">arrow_forward</i></div>'
            : '';

        return `
        <div class="flow-step">
            <div class="flow-icon ${estado}">
                <i class="material-symbols-outlined">${icon}</i>
            </div>
            <div class="flow-label">${esc(paso.label)}</div>
            <div class="flow-name">${esc(paso.nombre_aprobador)}</div>
            ${fechaHtml}
        </div>${arrow}`;
    }).join('');
}

// ══════════════════════════════════════════════════════════════
//  DECISIÓN: APROBAR / RECHAZAR
// ══════════════════════════════════════════════════════════════
function limpiarDecision() {
    accionSeleccionada = null;
    btnAprobar.classList.remove('selected');
    btnRechazar.classList.remove('selected');
    comentariosTextarea.value = '';
    btnConfirmarAprobacion.style.display = 'none';
    btnConfirmarRechazo.style.display    = 'none';
}

function seleccionarAprobar() {
    accionSeleccionada = 'aprobar';
    btnAprobar.classList.add('selected');
    btnRechazar.classList.remove('selected');
    btnConfirmarAprobacion.style.display = 'flex';
    btnConfirmarRechazo.style.display    = 'none';
}

function seleccionarRechazar() {
    accionSeleccionada = 'rechazar';
    btnRechazar.classList.add('selected');
    btnAprobar.classList.remove('selected');
    btnConfirmarRechazo.style.display    = 'flex';
    btnConfirmarAprobacion.style.display = 'none';
}

async function abrirModalConfirmacion() {
    if (!accionSeleccionada) {
        AppDialog.alert('Seleccione si desea aprobar o rechazar la solicitud.');
        return;
    }
    const comentarios = comentariosTextarea.value.trim();
    if (accionSeleccionada === 'rechazar' && comentarios.length < 10) {
        AppDialog.alert('Para rechazar debe ingresar un motivo (mínimo 10 caracteres).');
        comentariosTextarea.focus();
        return;
    }

    const s = solicitudSeleccionada;
    const esAprobar = accionSeleccionada === 'aprobar';

    document.getElementById('confirmTitulo').innerHTML = esAprobar
        ? '<i class="material-symbols-outlined">check_circle</i> Confirmar Aprobación'
        : '<i class="material-symbols-outlined">cancel</i> Confirmar Rechazo';

    document.getElementById('confirmMensaje').textContent = esAprobar
        ? '¿Está seguro de APROBAR esta solicitud de vacación?'
        : '¿Está seguro de RECHAZAR esta solicitud de vacación?';

    document.getElementById('confirmDetalles').innerHTML = `
        <p><strong>Funcionario:</strong> ${esc(s.funcionario)}</p>
        <p><strong>Días:</strong> ${s.dias}</p>
        <p><strong>Período:</strong> ${formatearFecha(s.fecha_salida)} – ${formatearFecha(s.fecha_retorno)}</p>
        ${comentarios ? `<p><strong>Comentarios:</strong> ${esc(comentarios)}</p>` : ''}
    `;

    modalConfirmacion.classList.add('show');
}

function cerrarModalConfirmacion() {
    modalConfirmacion.classList.remove('show');
}

// ══════════════════════════════════════════════════════════════
//  EJECUTAR DECISIÓN — POST al backend
// ══════════════════════════════════════════════════════════════
async function ejecutarDecision() {
    const comentarios = comentariosTextarea.value.trim();
    const decision    = accionSeleccionada === 'aprobar' ? 'APROBADO' : 'RECHAZADO';

    const btnFinal = document.getElementById('btnConfirmarFinal');
    btnFinal.disabled = true;

    try {
        const resp = await fetch(URL_DECISION, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': CSRF_TOKEN,
            },
            body: JSON.stringify({
                id_formulario: solicitudSeleccionada.id,
                decision: decision,
                observacion: comentarios,
            }),
        });

        const data = await resp.json();
        cerrarModalConfirmacion();
        cerrarModalAprobacion();

        if (!resp.ok || data.error) {
            AppDialog.alert(data.error || 'Error al procesar la decisión.');
            return;
        }

        const accion = decision === 'APROBADO' ? 'APROBADA' : 'RECHAZADA';
        AppDialog.alert(
            `Solicitud ${data.codigo} ${accion} exitosamente.`,
            { title: 'Operación completada', icon: 'check_circle', variant: 'success' }
        );

        setTimeout(() => location.reload(), 1600);

    } catch (err) {
        console.error('Error al ejecutar decisión:', err);
        AppDialog.alert('Error de conexión. Intente nuevamente.');
    } finally {
        btnFinal.disabled = false;
    }
}

// ══════════════════════════════════════════════════════════════
//  PERFIL DINÁMICO — usa profile-switcher.js compartido
// ══════════════════════════════════════════════════════════════

function renderizarRoles(roles, nombre, rolPrincipal) {
    window.initProfileSwitcher?.({ roles, nombre, rolActual: rolPrincipal || null });
    window.setupProfileToggle?.();
}

// ══════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════════════════════════════════════
function registrarEventListeners() {
    // Filtros
    document.getElementById('btnFiltrar').addEventListener('click', filtrarSolicitudes);
    document.getElementById('btnLimpiar').addEventListener('click', limpiarFiltros);
    document.getElementById('funcionarioFilter').addEventListener('keypress', e => {
        if (e.key === 'Enter') filtrarSolicitudes();
    });

    // Modal aprobación
    document.getElementById('btnCerrarModal').addEventListener('click', cerrarModalAprobacion);
    document.getElementById('btnCancelar').addEventListener('click', cerrarModalAprobacion);

    // Decisión
    btnAprobar.addEventListener('click', seleccionarAprobar);
    btnRechazar.addEventListener('click', seleccionarRechazar);
    btnConfirmarAprobacion.addEventListener('click', abrirModalConfirmacion);
    btnConfirmarRechazo.addEventListener('click', abrirModalConfirmacion);

    // Modal confirmación
    document.getElementById('btnCancelarConfirmacion').addEventListener('click', cerrarModalConfirmacion);
    document.getElementById('btnConfirmarFinal').addEventListener('click', ejecutarDecision);

    // El toggle del perfil lo maneja setupProfileToggle (llamado en renderizarRoles)
    // Cerrar modales al clic fuera

    window.addEventListener('click', e => {
        if (e.target === modalAprobacion)   cerrarModalAprobacion();
        if (e.target === modalConfirmacion) cerrarModalConfirmacion();
    });
}

// ══════════════════════════════════════════════════════════════
//  UTILIDADES
// ══════════════════════════════════════════════════════════════
function formatearFecha(fecha) {
    if (!fecha) return '—';
    const [a, m, d] = fecha.split('-');
    return `${d}/${m}/${a}`;
}

// Exponer globalmente para los onclick del HTML
window.abrirModalRevision = abrirModalRevision;
