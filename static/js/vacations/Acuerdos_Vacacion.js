'use strict';

const API_ACUERDOS = '/api/vacaciones/acuerdos/';

let _funcionarios  = [];
let _seleccionados = new Set();
let _combosListos  = false;

// ── Inicialización ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    cargarDatos();

    document.getElementById('btnNuevo').addEventListener('click', abrirModal);
    document.getElementById('btnCerrarModal').addEventListener('click', cerrarModal);
    document.getElementById('btnCancelar').addEventListener('click', cerrarModal);
    document.getElementById('btnGuardar').addEventListener('click', guardar);
    document.getElementById('unidadFiltro').addEventListener('change', renderFuncionarios);
    document.getElementById('buscarFunc').addEventListener('input', renderFuncionarios);

    document.getElementById('chkTodos').addEventListener('change', e => {
        funcionariosVisibles().forEach(f => {
            if (e.target.checked) _seleccionados.add(f.cod); else _seleccionados.delete(f.cod);
        });
        renderFuncionarios();
    });

    document.getElementById('funcList').addEventListener('change', e => {
        if (!e.target.matches('input[type=checkbox]')) return;
        if (e.target.checked) _seleccionados.add(e.target.value); else _seleccionados.delete(e.target.value);
        actualizarContador();
    });

    document.getElementById('acuerdosTableBody').addEventListener('click', e => {
        const btn = e.target.closest('.btn-revocar');
        if (btn) revocar(parseInt(btn.dataset.id, 10));
    });
});

// ── Carga de datos ────────────────────────────────────────────
async function cargarDatos() {
    const tableBody = document.getElementById('acuerdosTableBody');
    try {
        const res  = await fetch(API_ACUERDOS);
        const data = await res.json();

        if (!res.ok) {
            tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:#c00">${esc(data.error || 'Error al cargar datos.')}</td></tr>`;
            return;
        }

        window.initProfileSwitcher?.({ roles: data.usuario.roles, nombre: data.usuario.nombre });
        window.setupProfileToggle?.();

        _funcionarios = data.funcionarios;
        poblarComboUnidades(data.unidades);
        renderTable(data.acuerdos);
    } catch (err) {
        tableBody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#c00">Error de conexión.</td></tr>';
        console.error(err);
    }
}

function poblarComboUnidades(unidades) {
    if (_combosListos) return;
    _combosListos = true;
    const sel = document.getElementById('unidadFiltro');
    unidades.forEach(u => {
        const opt = document.createElement('option');
        opt.value       = u.id_unidad;
        opt.textContent = u.nombre;
        sel.appendChild(opt);
    });
}

// ── Tabla ─────────────────────────────────────────────────────
function renderTable(acuerdos) {
    const tableBody = document.getElementById('acuerdosTableBody');
    if (!acuerdos.length) {
        tableBody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#999">No hay acuerdos registrados.</td></tr>';
        return;
    }

    tableBody.innerHTML = acuerdos.map(a => {
        const tipo = a.tipo === 'COLECTIVO'
            ? '<span class="badge-tipo badge-colectivo">Colectivo</span>'
            : '<span class="badge-tipo badge-rechazo">Rechazo</span>';
        const estado = a.vigente
            ? '<span class="estado-vigente">Vigente</span>'
            : `<span class="estado-inactivo">${a.activo ? 'Vencido' : 'Revocado'}</span>`;
        const afectados = a.afectados.map(x => `${esc(x.nombre)} (${x.anio})`).join('<br>') || '—';
        return `
        <tr>
            <td>${tipo}</td>
            <td>${esc(a.solicitud || a.nro_documento)}</td>
            <td class="obs-cell">${esc(a.motivo)}</td>
            <td>${fmtFecha(a.fecha_acuerdo)}</td>
            <td style="font-weight:600">${fmtFecha(a.fecha_hasta)}</td>
            <td class="afectados-cell">${afectados}</td>
            <td>${esc(a.registrado_por)}</td>
            <td>${estado}</td>
            <td>${a.activo ? `<button class="btn-revocar" data-id="${a.id}">Revocar</button>` : ''}</td>
        </tr>`;
    }).join('');
}

// ── Modal ─────────────────────────────────────────────────────
function abrirModal() {
    _seleccionados = new Set();
    ['nroDocumento', 'motivo', 'fechaHasta', 'buscarFunc'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('fechaAcuerdo').value = new Date().toLocaleDateString('en-CA');
    document.getElementById('unidadFiltro').value = '';
    renderFuncionarios();
    document.getElementById('modalAcuerdo').classList.add('show');
}

function cerrarModal() {
    document.getElementById('modalAcuerdo').classList.remove('show');
}

function funcionariosVisibles() {
    const unidad = document.getElementById('unidadFiltro').value;
    const q      = document.getElementById('buscarFunc').value.trim().toLowerCase();
    return _funcionarios.filter(f =>
        (!unidad || String(f.id_unidad) === unidad) &&
        (!q || f.nombre.toLowerCase().includes(q))
    );
}

function renderFuncionarios() {
    const visibles = funcionariosVisibles();
    document.getElementById('funcList').innerHTML = visibles.map(f => `
        <label>
            <input type="checkbox" value="${esc(f.cod)}" ${_seleccionados.has(f.cod) ? 'checked' : ''}>
            ${esc(f.nombre)}
        </label>`).join('') || '<div style="color:#999;padding:8px">Sin resultados.</div>';
    document.getElementById('chkTodos').checked = visibles.length > 0 && visibles.every(f => _seleccionados.has(f.cod));
    actualizarContador();
}

function actualizarContador() {
    document.getElementById('contSeleccionados').textContent = _seleccionados.size;
}

// ── Acciones ──────────────────────────────────────────────────
async function guardar() {
    const btn = document.getElementById('btnGuardar');
    btn.disabled = true;
    try {
        const res = await fetch(API_ACUERDOS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': _csrf() },
            body: JSON.stringify({
                nro_documento: document.getElementById('nroDocumento').value.trim(),
                fecha_acuerdo: document.getElementById('fechaAcuerdo').value,
                fecha_hasta:   document.getElementById('fechaHasta').value,
                motivo:        document.getElementById('motivo').value.trim(),
                funcionarios:  [..._seleccionados],
            }),
        });
        const data = await res.json();
        if (!res.ok) {
            AppDialog.alert(data.error || 'Error al registrar el acuerdo.', { title: 'Error', icon: 'error', variant: 'danger' });
            return;
        }
        cerrarModal();
        await cargarDatos();
        AppDialog.alert(
            `Acuerdo registrado: ${data.gestiones} gestión(es) protegida(s) de ${data.funcionarios} funcionario(s).`,
            { title: 'Operación completada', icon: 'check_circle', variant: 'success' }
        );
    } catch (e) {
        AppDialog.alert('Error de red al registrar el acuerdo.', { title: 'Error', icon: 'error', variant: 'danger' });
    } finally {
        btn.disabled = false;
    }
}

async function revocar(id) {
    const ok = await AppDialog.confirm(
        '¿Revocar este acuerdo? Las gestiones que protegía volverán a perderse por el tope normal en la próxima acreditación.',
        { title: 'Revocar acuerdo', icon: 'warning', variant: 'danger' }
    );
    if (!ok) return;
    try {
        const res  = await fetch(`${API_ACUERDOS}${id}/revocar/`, { method: 'POST', headers: { 'X-CSRFToken': _csrf() } });
        const data = await res.json();
        if (!res.ok) {
            AppDialog.alert(data.error || 'No se pudo revocar.', { title: 'Error', icon: 'error', variant: 'danger' });
            return;
        }
        await cargarDatos();
    } catch (e) {
        AppDialog.alert('Error de red al revocar.', { title: 'Error', icon: 'error', variant: 'danger' });
    }
}

// ── Helpers ───────────────────────────────────────────────────
function _csrf() {
    return document.querySelector('meta[name="csrf-token"]')?.content ?? '';
}

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
