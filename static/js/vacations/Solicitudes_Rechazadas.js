'use strict';

const API_RECHAZADAS = '/api/vacaciones/rechazadas/';
const API_PDF        = '/api/vacaciones/rechazadas/pdf/';

let _pendientePDF   = null;
let _combosListos   = false;

// ── Inicialización ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    cargarDatos();

    document.getElementById('btnFilter').addEventListener('click', handleFilter);
    document.getElementById('btnClear').addEventListener('click', handleClear);
    document.getElementById('funcionarioFilter').addEventListener('keydown', e => {
        if (e.key === 'Enter') handleFilter();
    });

    document.getElementById('btnCancelarPDF').addEventListener('click', cerrarModal);
    document.getElementById('btnConfirmarPDF').addEventListener('click', confirmarDescarga);

    document.getElementById('rechazadasTableBody').addEventListener('click', e => {
        const btn = e.target.closest('.btn-pdf');
        if (!btn) return;
        abrirModal(parseInt(btn.dataset.id, 10), btn.dataset.nombre, btn.dataset.fecha);
    });

    document.getElementById('modalPDF').addEventListener('click', e => {
        if (e.target.classList.contains('modal-overlay')) cerrarModal();
    });
});

// ── Carga de datos ────────────────────────────────────────────
async function cargarDatos(params = {}) {
    const tableBody = document.getElementById('rechazadasTableBody');
    tableBody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:30px;color:#999">Cargando...</td></tr>';

    const url = new URL(API_RECHAZADAS, window.location.origin);
    Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });

    try {
        const res  = await fetch(url);
        const data = await res.json();

        if (!res.ok) {
            tableBody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:30px;color:#c00">${data.error || 'Error al cargar datos.'}</td></tr>`;
            return;
        }

        window.initProfileSwitcher?.({ roles: data.usuario.roles, nombre: data.usuario.nombre });
        window.setupProfileToggle?.();

        poblarComboUnidades(data.filtros.unidades);
        renderTable(data.solicitudes);

    } catch (err) {
        tableBody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:30px;color:#c00">Error de conexión.</td></tr>';
        console.error(err);
    }
}

// ── Combo unidades ────────────────────────────────────────────
function poblarComboUnidades(unidades) {
    if (_combosListos) return;
    _combosListos = true;
    const sel = document.getElementById('unidadOrg');
    unidades.forEach(u => {
        const opt = document.createElement('option');
        opt.value       = u.id_unidad;
        opt.textContent = u.nombre;
        sel.appendChild(opt);
    });
}

// ── Render tabla ──────────────────────────────────────────────
function renderTable(solicitudes) {
    const tableBody = document.getElementById('rechazadasTableBody');
    const badge     = document.getElementById('totalBadge');
    if (badge) badge.textContent = solicitudes.length;

    if (!solicitudes.length) {
        tableBody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:30px;color:#999">No se encontraron solicitudes rechazadas.</td></tr>';
        return;
    }

    tableBody.innerHTML = solicitudes.map(s => `
        <tr>
            <td style="font-weight:600;color:#720035">${s.codigo}</td>
            <td>
                <div style="font-weight:600">${esc(s.funcionario)}</div>
                <div style="font-size:0.8em;color:#888">${esc(s.cargo)}</div>
            </td>
            <td>${esc(s.unidad)}</td>
            <td>${fmtFecha(s.fecha_solicitud)}</td>
            <td>${fmtFecha(s.fecha_salida)}</td>
            <td>${fmtFecha(s.fecha_retorno)}</td>
            <td style="text-align:center;font-weight:600">${s.dias}</td>
            <td>
                <span class="badge-rechazo">
                    <i class="material-symbols-outlined" style="font-size:13px">block</i>
                    ${esc(s.label_rechazo)}
                </span>
                <div style="font-size:0.82em;color:#555;margin-top:3px">${esc(s.aprobador_rechazo)}</div>
            </td>
            <td>${s.fecha_rechazo ? fmtFecha(s.fecha_rechazo) : '—'}</td>
            <td class="obs-cell">${esc(s.observacion || '—')}</td>
            <td style="text-align:center">
                <button class="btn-pdf"
                    data-id="${s.id}"
                    data-nombre="${esc(s.funcionario)}"
                    data-fecha="${fmtFecha(s.fecha_solicitud)}"
                    title="Descargar PDF">
                    <i class="material-symbols-outlined">picture_as_pdf</i>
                </button>
            </td>
        </tr>
    `).join('');
}

// ── Modal PDF ─────────────────────────────────────────────────
function abrirModal(id, nombre, fecha) {
    _pendientePDF = id;
    document.getElementById('modalPDFMensaje').innerHTML =
        `¿Desea descargar el formulario de rechazo de la solicitud <strong>${fecha}</strong> del funcionario <strong>${esc(nombre)}</strong>?`;
    const overlay = document.getElementById('modalPDF');
    overlay.classList.add('active');
    overlay.querySelector('.form-modal').classList.add('active');
}

function cerrarModal() {
    const overlay = document.getElementById('modalPDF');
    overlay.classList.remove('active');
    overlay.querySelector('.form-modal').classList.remove('active');
    _pendientePDF = null;
}

function confirmarDescarga() {
    if (!_pendientePDF) return;
    const id = _pendientePDF;
    cerrarModal();
    const a = document.createElement('a');
    a.href = `${API_PDF}${id}/`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 0);
}

// ── Helpers ───────────────────────────────────────────────────
function fmtFecha(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function handleFilter() {
    const unidad      = document.getElementById('unidadOrg').value;
    const funcionario = document.getElementById('funcionarioFilter').value.trim();
    cargarDatos({ unidad, funcionario });
}

function handleClear() {
    document.getElementById('unidadOrg').value         = '';
    document.getElementById('funcionarioFilter').value = '';
    _combosListos = false;
    cargarDatos();
}
