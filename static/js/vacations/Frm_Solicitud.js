'use strict';

const API_HISTORIAL = '/api/vacaciones/historial-rrhh/';
const API_PDF       = '/api/vacaciones/historial-rrhh/pdf/';

let _pendientePDF = null;
let _combosListos = false;

// ── Inicialización ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    cargarDatos();

    document.getElementById('btnFilter').addEventListener('click', handleFilter);
    document.getElementById('btnClear').addEventListener('click', handleClear);
    document.getElementById('btnCancelarPDF').addEventListener('click', cerrarModal);
    document.getElementById('btnConfirmarPDF').addEventListener('click', confirmarDescarga);
    document.getElementById('funcionarioFilter').addEventListener('keydown', e => {
        if (e.key === 'Enter') handleFilter();
    });

    // Event delegation para botones PDF — evita problemas con onclick inline
    document.getElementById('vacationTableBody').addEventListener('click', e => {
        const btn = e.target.closest('.btn-pdf');
        if (!btn) return;
        abrirModalPDF(
            parseInt(btn.dataset.id, 10),
            btn.dataset.nombre,
            btn.dataset.fecha
        );
    });
});

// ── Carga de datos ────────────────────────────────────────────
async function cargarDatos(params = {}) {
    const tableBody = document.getElementById('vacationTableBody');
    tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#999">Cargando...</td></tr>';

    const url = new URL(API_HISTORIAL, window.location.origin);
    Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });

    try {
        const res  = await fetch(url);
        const data = await res.json();

        if (!res.ok) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:#c00">${data.error || 'Error al cargar datos.'}</td></tr>`;
            return;
        }

        window.initProfileSwitcher?.({ roles: data.usuario.roles, nombre: data.usuario.nombre });
        window.setupProfileToggle?.();

        poblarCombos(data.filtros);
        renderTable(data.solicitudes);

    } catch (err) {
        tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#c00">Error de conexión.</td></tr>';
        console.error(err);
    }
}

// ── Poblar combos (solo la primera carga) ─────────────────────
function poblarCombos(filtros) {
    if (_combosListos) return;
    _combosListos = true;

    const selUnidad = document.getElementById('unidadOrg');
    filtros.unidades.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id_unidad;
        opt.textContent = u.nombre;
        selUnidad.appendChild(opt);
    });

    const selContrato = document.getElementById('tipoContrato');
    filtros.tipos_contrato.forEach(tc => {
        const opt = document.createElement('option');
        opt.value = tc;
        opt.textContent = tc;
        selContrato.appendChild(opt);
    });
}

// ── Render de tabla ───────────────────────────────────────────
function renderTable(solicitudes) {
    const tableBody = document.getElementById('vacationTableBody');
    tableBody.innerHTML = '';

    if (!solicitudes.length) {
        tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#999">No se encontraron solicitudes aprobadas.</td></tr>';
        return;
    }

    solicitudes.forEach(sol => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Funcionario"><strong>${esc(sol.funcionario)}</strong></td>
            <td data-label="Cargo">${esc(sol.cargo)}</td>
            <td data-label="Fecha Solicitud">${fmt(sol.fecha_solicitud)}</td>
            <td data-label="Fecha Inicio">${fmt(sol.fecha_salida)}</td>
            <td data-label="Días Solicitados">${sol.dias}</td>
            <td data-label="Fecha Final">${fmt(sol.fecha_retorno)}</td>
            <td data-label="Saldo de Días Adeudados">${sol.dias_adeudados.toFixed(1)}</td>
            <td data-label="Documento PDF">
                <button class="btn-pdf"
                    data-id="${sol.id}"
                    data-nombre="${esc(sol.funcionario)}"
                    data-fecha="${sol.fecha_solicitud}">
                    <i class="material-symbols-outlined">picture_as_pdf</i>
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

// ── Filtros ───────────────────────────────────────────────────
function handleFilter() {
    cargarDatos({
        unidad:        document.getElementById('unidadOrg').value,
        tipo_contrato: document.getElementById('tipoContrato').value,
        funcionario:   document.getElementById('funcionarioFilter').value.trim(),
    });
}

function handleClear() {
    document.getElementById('unidadOrg').value        = '';
    document.getElementById('tipoContrato').value      = '';
    document.getElementById('funcionarioFilter').value = '';
    cargarDatos();
}

// ── Modal PDF ─────────────────────────────────────────────────
function abrirModalPDF(id, nombre, fechaSol) {
    _pendientePDF = id;
    document.getElementById('modalPDFMensaje').textContent =
        `Descargando PDF para la solicitud de ${nombre}, presentada el ${fmt(fechaSol)}.`;
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

// ── Utilidades ────────────────────────────────────────────────
function fmt(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
