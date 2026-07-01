'use strict';

const API_RECHAZADAS = '/api/vacaciones/rechazadas/';

// ── Inicialización ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    cargarDatos();

    document.getElementById('btnFilter').addEventListener('click', handleFilter);
    document.getElementById('btnClear').addEventListener('click', handleClear);
    document.getElementById('funcionarioFilter').addEventListener('keydown', e => {
        if (e.key === 'Enter') handleFilter();
    });
});

// ── Carga de datos ────────────────────────────────────────────
async function cargarDatos(params = {}) {
    const tableBody = document.getElementById('rechazadasTableBody');
    tableBody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:#999">Cargando...</td></tr>';

    const url = new URL(API_RECHAZADAS, window.location.origin);
    Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });

    try {
        const res  = await fetch(url);
        const data = await res.json();

        if (!res.ok) {
            tableBody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:30px;color:#c00">${data.error || 'Error al cargar datos.'}</td></tr>`;
            return;
        }

        window.initProfileSwitcher?.({ roles: data.usuario.roles, nombre: data.usuario.nombre });
        window.setupProfileToggle?.();

        poblarComboUnidades(data.filtros.unidades);
        renderTable(data.solicitudes);

    } catch (err) {
        tableBody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:#c00">Error de conexión.</td></tr>';
        console.error(err);
    }
}

// ── Combo unidades ────────────────────────────────────────────
let _combosListos = false;

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
        tableBody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:#999">No se encontraron solicitudes rechazadas.</td></tr>';
        return;
    }

    tableBody.innerHTML = solicitudes.map(s => `
        <tr>
            <td style="font-weight:600;color:#720035">${s.codigo}</td>
            <td>
                <div style="font-weight:600">${s.funcionario}</div>
                <div style="font-size:0.8em;color:#888">${s.cargo}</div>
            </td>
            <td>${s.unidad}</td>
            <td>${fmtFecha(s.fecha_solicitud)}</td>
            <td>${fmtFecha(s.fecha_salida)}</td>
            <td>${fmtFecha(s.fecha_retorno)}</td>
            <td style="text-align:center;font-weight:600">${s.dias}</td>
            <td>
                <span class="badge-rechazo">
                    <i class="material-symbols-outlined" style="font-size:13px">block</i>
                    ${s.label_rechazo}
                </span>
                <div style="font-size:0.82em;color:#555;margin-top:3px">${s.aprobador_rechazo}</div>
            </td>
            <td>${s.fecha_rechazo ? fmtFecha(s.fecha_rechazo) : '—'}</td>
            <td class="obs-cell">${s.observacion || '—'}</td>
        </tr>
    `).join('');
}

// ── Helpers ───────────────────────────────────────────────────
function fmtFecha(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

function handleFilter() {
    const unidad      = document.getElementById('unidadOrg').value;
    const funcionario = document.getElementById('funcionarioFilter').value.trim();
    cargarDatos({ unidad, funcionario });
}

function handleClear() {
    document.getElementById('unidadOrg').value        = '';
    document.getElementById('funcionarioFilter').value = '';
    cargarDatos();
}
