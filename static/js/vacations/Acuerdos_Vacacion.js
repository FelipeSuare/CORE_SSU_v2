'use strict';

const API_ACUERDOS = '/api/vacaciones/acuerdos/';

let _acuerdos      = [];
let _funcionarios  = [];
let _seleccion     = new Map();   // cod → Set(anios)
let _modificaId    = null;        // acuerdo que se está modificando
let _anularId      = null;
let _combosListos  = false;

// ── Inicialización ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    cargarDatos();

    document.getElementById('btnNuevo').addEventListener('click', () => abrirModal());
    document.getElementById('btnGuardar').addEventListener('click', guardar);
    document.getElementById('btnConfirmarAnular').addEventListener('click', confirmarAnular);
    document.getElementById('unidadFiltro').addEventListener('change', renderFuncionarios);
    document.getElementById('buscarFunc').addEventListener('input', renderFuncionarios);

    document.querySelectorAll('[data-cerrar]').forEach(b =>
        b.addEventListener('click', () => cerrar(b.dataset.cerrar)));

    document.querySelectorAll('input[name=tipo]').forEach(r => r.addEventListener('change', () => {
        if (tipoActual() === 'INDIVIDUAL' && _seleccion.size > 1) _seleccion = new Map();
        renderFuncionarios();
    }));

    document.getElementById('chkTodos').addEventListener('change', e => {
        funcionariosVisibles().filter(f => !bloqueado(f)).forEach(f => {
            if (e.target.checked) seleccionar(f); else _seleccion.delete(f.cod);
        });
        renderFuncionarios();
    });

    document.getElementById('funcList').addEventListener('change', e => {
        const t = e.target;
        if (t.classList.contains('chk-func')) {
            const f = _funcionarios.find(x => x.cod === t.value);
            if (!t.checked) _seleccion.delete(f.cod);
            else {
                if (tipoActual() === 'INDIVIDUAL') _seleccion = new Map();
                seleccionar(f);
            }
            renderFuncionarios();
        } else if (t.classList.contains('chk-gest')) {
            const anios = _seleccion.get(t.dataset.cod);
            const anio  = parseInt(t.dataset.anio, 10);
            if (t.checked) anios.add(anio); else anios.delete(anio);
        }
    });

    document.getElementById('acuerdosTableBody').addEventListener('click', e => {
        const btn = e.target.closest('[data-accion]');
        if (!btn) return;
        const ac = _acuerdos.find(a => a.id === parseInt(btn.dataset.id, 10));
        ({ ver: verDetalle, anular: abrirAnular, modificar: a => abrirModal(a) })[btn.dataset.accion](ac);
    });

    document.getElementById('detalleBody').addEventListener('click', e => {
        const link = e.target.closest('[data-ver]');
        if (link) verDetalle(_acuerdos.find(a => a.id === parseInt(link.dataset.ver, 10)));
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

        _acuerdos     = data.acuerdos;
        _funcionarios = data.funcionarios;
        poblarCombos(data.unidades, data.gerentes);
        renderTable();
    } catch (err) {
        tableBody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#c00">Error de conexión.</td></tr>';
        console.error(err);
    }
}

function poblarCombos(unidades, gerentes) {
    document.getElementById('autorizadoPor').innerHTML = gerentes.length
        ? gerentes.map(g => `<option value="${esc(g.cod)}">${esc(g.nombre)}</option>`).join('')
        : '<option value="">No hay Gerente General activo</option>';
    if (_combosListos) return;
    _combosListos = true;
    const sel = document.getElementById('unidadFiltro');
    unidades.forEach(u => sel.add(new Option(u.nombre, u.id_unidad)));
}

// ── Tabla ─────────────────────────────────────────────────────
const TIPO_BADGE = {
    COLECTIVO:  '<span class="badge badge-colectivo">Colectivo</span>',
    INDIVIDUAL: '<span class="badge badge-individual">Individual</span>',
    RECHAZO:    '<span class="badge badge-rechazo">Rechazo cerca del vencimiento</span>',
};

function estadoHtml(a) {
    if (a.estado === 'VIGENTE') {
        return a.vigente ? '<span class="badge estado-vigente">Vigente</span>'
                         : '<span class="badge estado-vencido">Vencido</span>';
    }
    return a.estado === 'ANULADO' ? '<span class="badge estado-anulado">Anulado</span>'
                                  : '<span class="badge estado-modificado">Modificado</span>';
}

function renderTable() {
    const tableBody = document.getElementById('acuerdosTableBody');
    if (!_acuerdos.length) {
        tableBody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#999">No hay acuerdos registrados.</td></tr>';
        return;
    }

    tableBody.innerHTML = _acuerdos.map(a => {
        const nFunc = new Set(a.afectados.map(x => x.cod)).size;
        const acciones = [`<button class="action-btn action-btn-edit" title="Ver" data-accion="ver" data-id="${a.id}"><i class="material-symbols-outlined">visibility</i></button>`];
        if (a.estado === 'VIGENTE') {
            if (a.tipo !== 'RECHAZO') acciones.push(`<button class="action-btn action-btn-edit" title="Modificar" data-accion="modificar" data-id="${a.id}"><i class="material-symbols-outlined">edit</i></button>`);
            acciones.push(`<button class="action-btn action-btn-delete" title="Anular" data-accion="anular" data-id="${a.id}"><i class="material-symbols-outlined">block</i></button>`);
        }
        return `
        <tr>
            <td class="nro">${esc(a.nro || a.solicitud || '—')}</td>
            <td>${TIPO_BADGE[a.tipo] || esc(a.tipo)}</td>
            <td class="obs-cell">${esc(a.motivo)}</td>
            <td>${fmtFecha(a.fecha_acuerdo)}</td>
            <td style="font-weight:600">${fmtFecha(a.fecha_hasta)}</td>
            <td>${nFunc}</td>
            <td>${esc(a.autorizado_por || '—')}</td>
            <td>${estadoHtml(a)}</td>
            <td style="white-space:nowrap">${acciones.join('')}</td>
        </tr>`;
    }).join('');
}

// ── Detalle (solo lectura) ────────────────────────────────────
function verDetalle(a) {
    const ref = r => r ? `<span class="link-acuerdo" data-ver="${r.id}">${esc(r.nro)}</span>` : '';
    const filas = [
        ['Tipo', TIPO_BADGE[a.tipo]],
        ['Estado', estadoHtml(a)],
        a.solicitud && ['Solicitud rechazada', esc(a.solicitud)],
        ['Motivo', esc(a.motivo)],
        ['Fecha del acuerdo', fmtFecha(a.fecha_acuerdo)],
        ['Nueva fecha límite', fmtFecha(a.fecha_hasta)],
        ['Registrado por', esc(a.registrado_por)],
        a.autorizado_por && ['Autorizado por', esc(a.autorizado_por)],
        a.modifica_a && ['Modifica al acuerdo', ref(a.modifica_a)],
        a.reemplazado_por && ['Reemplazado por', ref(a.reemplazado_por)],
        a.estado === 'ANULADO' && ['Anulado por', `${esc(a.anulado_por || '—')} · ${esc(a.fecha_anulacion || '')}`],
        a.estado === 'ANULADO' && ['Motivo de anulación', esc(a.motivo_anulacion || '—')],
    ].filter(Boolean);

    const porFunc = new Map();
    a.afectados.forEach(x => {
        if (!porFunc.has(x.cod)) porFunc.set(x.cod, { nombre: x.nombre, gest: [] });
        porFunc.get(x.cod).gest.push(`${x.anio} (${x.dias} días)`);
    });
    const conPdf = a.tipo !== 'RECHAZO';

    document.getElementById('detalleTitulo').textContent = a.nro ? `Acuerdo ${a.nro}` : `Protección por rechazo ${a.solicitud || ''}`;
    document.getElementById('detalleBody').innerHTML = `
        <dl class="detalle-grid">${filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
        <div class="table-responsive">
            <table>
                <thead><tr><th>Funcionario</th><th>Gestiones protegidas</th>${conPdf ? '<th style="text-align:center">Constancia</th>' : ''}</tr></thead>
                <tbody>${[...porFunc].map(([cod, f]) => `
                    <tr>
                        <td>${esc(f.nombre)}</td>
                        <td>${esc(f.gest.join(', '))}</td>
                        ${conPdf ? `<td style="text-align:center"><a class="btn-pdf" title="Descargar constancia PDF" href="${API_ACUERDOS}${a.id}/constancia/${encodeURIComponent(cod)}/">
                            <i class="material-symbols-outlined">picture_as_pdf</i></a></td>` : ''}
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
    document.getElementById('modalDetalle').classList.add('show');
}

// ── Registrar / modificar ─────────────────────────────────────
function abrirModal(original = null) {
    _modificaId = original ? original.id : null;
    _seleccion  = new Map();

    document.getElementById('modalTitulo').textContent = original ? `Modificar acuerdo ${original.nro}` : 'Registrar acuerdo';
    document.getElementById('avisoModifica').hidden = !original;
    document.getElementById('modificaNro').textContent = original ? original.nro : '';
    document.getElementById('nroAcuerdo').value = original ? original.nro : 'Se asignará al guardar';
    document.getElementById('buscarFunc').value = '';
    document.getElementById('unidadFiltro').value = '';

    document.getElementById('motivo').value       = original ? original.motivo : '';
    document.getElementById('fechaAcuerdo').value = original ? original.fecha_acuerdo : new Date().toLocaleDateString('en-CA');
    document.getElementById('fechaHasta').value   = original ? original.fecha_hasta : '';
    document.querySelector(`input[name=tipo][value=${original ? original.tipo : 'COLECTIVO'}]`).checked = true;
    if (original) {
        // Se parte de las mismas gestiones del original; el usuario ajusta.
        original.afectados.forEach(x => {
            if (!_seleccion.has(x.cod)) _seleccion.set(x.cod, new Set());
            _seleccion.get(x.cod).add(x.anio);
        });
    }

    renderFuncionarios();
    document.getElementById('modalAcuerdo').classList.add('show');
}

function tipoActual() {
    return document.querySelector('input[name=tipo]:checked').value;
}

function gestionLibre(g) {
    return g.protegida_por === null || g.protegida_por === _modificaId;
}

function bloqueado(f) {
    return !f.gestiones.some(gestionLibre);
}

function seleccionar(f) {
    _seleccion.set(f.cod, new Set(f.gestiones.filter(gestionLibre).map(g => g.anio)));
}

function funcionariosVisibles() {
    const unidad = document.getElementById('unidadFiltro').value;
    const q      = document.getElementById('buscarFunc').value.trim().toLowerCase();
    return _funcionarios.filter(f =>
        _seleccion.has(f.cod) || (
            (!unidad || String(f.id_unidad) === unidad) &&
            (!q || f.nombre.toLowerCase().includes(q))
        )
    );
}

function renderFuncionarios() {
    const individual = tipoActual() === 'INDIVIDUAL';
    const visibles   = funcionariosVisibles();
    const nroDe      = id => _acuerdos.find(a => a.id === id)?.nro || 'otro acuerdo';

    document.getElementById('lblTodos').hidden = individual;
    document.getElementById('funcList').innerHTML = visibles.map(f => {
        const sel  = _seleccion.get(f.cod);
        const nota = !f.gestiones.length ? 'sin gestiones pendientes'
                   : !f.gestiones.some(gestionLibre) ? 'gestiones ya protegidas' : '';
        const gestiones = sel ? `
            <div class="gestiones">${f.gestiones.map(g => {
                const libre = gestionLibre(g);
                return `<label>
                    <input type="checkbox" class="chk-gest" data-cod="${esc(f.cod)}" data-anio="${g.anio}"
                        ${sel.has(g.anio) ? 'checked' : ''} ${libre ? '' : 'disabled'}>
                    Gestión ${g.anio} — <span class="dias">${g.dias} días</span>
                    ${libre ? '' : `<span class="nota">(protegida por ${esc(g.protegida_por ? nroDe(g.protegida_por) : '')})</span>`}
                </label>`;
            }).join('')}</div>` : '';
        return `
        <div class="func-item">
            <label>
                <input type="checkbox" class="chk-func" value="${esc(f.cod)}" ${sel ? 'checked' : ''} ${bloqueado(f) && !sel ? 'disabled' : ''}>
                ${esc(f.nombre)} ${nota ? `<span class="nota" style="color:#999;font-weight:400">· ${nota}</span>` : ''}
            </label>${gestiones}
        </div>`;
    }).join('') || '<div style="color:#999;padding:8px">Sin resultados.</div>';

    const marcables = visibles.filter(f => !bloqueado(f));
    document.getElementById('chkTodos').checked = marcables.length > 0 && marcables.every(f => _seleccion.has(f.cod));
    document.getElementById('contSeleccionados').textContent = _seleccion.size;
}

async function guardar() {
    const body = {
        funcionarios: [..._seleccion].map(([cod, anios]) => ({ cod, anios: [...anios] })),
        tipo:           tipoActual(),
        motivo:         document.getElementById('motivo').value.trim(),
        fecha_acuerdo:  document.getElementById('fechaAcuerdo').value,
        fecha_hasta:    document.getElementById('fechaHasta').value,
        autorizado_por: document.getElementById('autorizadoPor').value,
        modifica_id:    _modificaId,
    };

    const btn = document.getElementById('btnGuardar');
    btn.disabled = true;
    try {
        const res = await fetch(API_ACUERDOS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': _csrf() },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
            AppDialog.alert(data.error || 'Error al registrar el acuerdo.', { title: 'Error', icon: 'error', variant: 'danger' });
            return;
        }
        cerrar('modalAcuerdo');
        await cargarDatos();
        AppDialog.alert(
            `Acuerdo ${data.nro}: ${data.gestiones} gestión(es) protegida(s) de ${data.funcionarios.length} funcionario(s). ` +
            'Las constancias individuales están disponibles en "Ver".',
            { title: 'Operación completada', icon: 'check_circle', variant: 'success' }
        );
    } catch (e) {
        AppDialog.alert('Error de red al registrar el acuerdo.', { title: 'Error', icon: 'error', variant: 'danger' });
    } finally {
        btn.disabled = false;
    }
}

// ── Anular ────────────────────────────────────────────────────
function abrirAnular(a) {
    _anularId = a.id;
    document.getElementById('anularNro').textContent = a.nro || a.solicitud || '';
    document.getElementById('motivoAnulacion').value = '';
    document.getElementById('modalAnular').classList.add('show');
}

async function confirmarAnular() {
    const btn = document.getElementById('btnConfirmarAnular');
    btn.disabled = true;
    try {
        const res = await fetch(`${API_ACUERDOS}${_anularId}/anular/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': _csrf() },
            body: JSON.stringify({ motivo: document.getElementById('motivoAnulacion').value.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
            AppDialog.alert(data.error || 'No se pudo anular.', { title: 'Error', icon: 'error', variant: 'danger' });
            return;
        }
        cerrar('modalAnular');
        await cargarDatos();
    } catch (e) {
        AppDialog.alert('Error de red al anular.', { title: 'Error', icon: 'error', variant: 'danger' });
    } finally {
        btn.disabled = false;
    }
}

// ── Helpers ───────────────────────────────────────────────────
function cerrar(id) {
    document.getElementById(id).classList.remove('show');
}

function _csrf() {
    return document.querySelector('meta[name="csrf-token"]')?.content ?? '';
}

function fmtFecha(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
