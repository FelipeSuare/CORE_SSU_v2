// ══════════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ══════════════════════════════════════════════════════════════
const CSRF_TOKEN    = document.querySelector('meta[name="csrf-token"]').content;
const URL_BUSCAR    = '/funcionarios/buscar/';
const URL_HISTORIAL = cod => `/funcionarios/${cod}/historial-cargos/`;

// ══════════════════════════════════════════════════════════════
//  ESTADO
// ══════════════════════════════════════════════════════════════
let funcionarioSeleccionado = null;
let cargosDelFuncionario    = [];
let rolLabel                = 'RECURSOS HUMANOS';
let _debounceTimer          = null;

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    cargarPerfil();

    const input = document.getElementById('searchFuncionario');
    input.addEventListener('input',   () => mostrarSugerencias());
    input.addEventListener('keypress', e => { if (e.key === 'Enter') buscarFuncionarioManual(); });

    document.addEventListener('click', e => {
        if (!e.target.closest('.search-box')) {
            document.getElementById('sugerenciasDropdown').style.display = 'none';
        }
    });
});

async function cargarPerfil() {
    try {
        const resp = await fetch('/api/usuario/mi-perfil/', { headers: { 'X-CSRFToken': CSRF_TOKEN } });
        const data = await resp.json();
        if (!data.error) {
            window.initProfileSwitcher?.({ roles: data.roles, nombre: data.nombre_completo });
            window.setupProfileToggle?.();
        }
    } catch (e) {
        console.error('Error cargando perfil:', e);
    }
}

// ══════════════════════════════════════════════════════════════
//  AUTOCOMPLETADO
// ══════════════════════════════════════════════════════════════
function mostrarSugerencias() {
    clearTimeout(_debounceTimer);
    const texto = document.getElementById('searchFuncionario').value.trim();
    if (texto.length < 2) {
        document.getElementById('sugerenciasDropdown').style.display = 'none';
        return;
    }
    _debounceTimer = setTimeout(() => _fetchSugerencias(texto), 260);
}

async function _fetchSugerencias(texto) {
    const dropdown = document.getElementById('sugerenciasDropdown');
    try {
        const resp = await fetch(`${URL_BUSCAR}?q=${encodeURIComponent(texto)}`, {
            headers: { 'X-CSRFToken': CSRF_TOKEN },
        });
        const data = await resp.json();
        const hits = data.funcionarios ?? [];

        if (!hits.length) {
            dropdown.innerHTML = `
                <div class="sug-item sug-empty">
                    <i class="material-symbols-outlined">person_off</i> No se encontró funcionario
                </div>`;
        } else {
            dropdown.innerHTML = hits.map(f => `
                <div class="sug-item" onclick="seleccionarFuncionario('${f.cod_funcionario}')">
                    <i class="material-symbols-outlined sug-icon">person</i>
                    <div>
                        <div class="sug-nombre">${_resaltar(_escHtml(f.nombre_completo), texto)}</div>
                        <div class="sug-ci">C.I. ${f.ci}</div>
                    </div>
                </div>`).join('');
        }
        dropdown.style.display = 'block';
    } catch (err) {
        console.error('Error en autocompletado:', err);
    }
}

function buscarFuncionarioManual() {
    const texto = document.getElementById('searchFuncionario').value.trim();
    if (texto.length >= 2) _fetchSugerencias(texto);
}

async function seleccionarFuncionario(cod) {
    clearTimeout(_debounceTimer);
    document.getElementById('sugerenciasDropdown').style.display = 'none';
    await cargarFuncionario(cod);
}

// ══════════════════════════════════════════════════════════════
//  CARGAR FUNCIONARIO DESDE API
// ══════════════════════════════════════════════════════════════
async function cargarFuncionario(cod) {
    try {
        const resp = await fetch(URL_HISTORIAL(cod), { headers: { 'X-CSRFToken': CSRF_TOKEN } });
        const data = await resp.json();
        if (data.error) { console.error(data.error); return; }

        funcionarioSeleccionado = data.funcionario;
        cargosDelFuncionario    = data.cargos;
        rolLabel                = data.rol_label;

        document.getElementById('searchFuncionario').value          = data.funcionario.nombre_completo;
        document.getElementById('tableCard').style.display          = 'block';
        document.getElementById('placeholderCard').style.display    = 'none';

        renderizarBanner();
        actualizarResumen();
        renderizarCargos();
    } catch (err) {
        console.error('Error cargando historial:', err);
    }
}

// ══════════════════════════════════════════════════════════════
//  BANNER DEL FUNCIONARIO
// ══════════════════════════════════════════════════════════════
function renderizarBanner() {
    const f = funcionarioSeleccionado;
    document.getElementById('funcionarioBanner').innerHTML = `
        <div class="func-avatar"><i class="material-symbols-outlined">person</i></div>
        <div class="func-info">
            <div class="func-nombre">${_escHtml(f.nombre_completo)}</div>
            <div class="func-meta">
                ${f.cargo_actual ? `<span><i class="material-symbols-outlined">work</i> ${_escHtml(f.cargo_actual)}</span>` : ''}
                <span><i class="material-symbols-outlined">calendar_month</i> Ingreso: ${formatearFecha(f.fecha_ingreso)}</span>
            </div>
        </div>`;
}

// ══════════════════════════════════════════════════════════════
//  RESUMEN DE CARGOS
// ══════════════════════════════════════════════════════════════
function actualizarResumen() {
    const total     = cargosDelFuncionario.length;
    const anteriores = cargosDelFuncionario.filter(c => !c.es_actual).length;
    document.getElementById('subtituloResumen').innerHTML = `
        <span class="resumen-inline">
            <span class="resumen-item-cargos">
                <i class="material-symbols-outlined">work</i>
                ${total} cargo${total !== 1 ? 's' : ''} (${anteriores} anteriores)
            </span>
        </span>`;
}

// ══════════════════════════════════════════════════════════════
//  RENDERIZAR BLOQUES DE CARGO
// ══════════════════════════════════════════════════════════════
function renderizarCargos() {
    const container = document.getElementById('cargosContainer');
    container.innerHTML = '';

    cargosDelFuncionario.forEach((c, idx) => {
        const mostrarSaldoAnt = idx > 0;

        const gestiones = c.gestiones.length ? c.gestiones : [{ anio: null, saldo: 0 }];

        const thSaldoAnterior = mostrarSaldoAnt
            ? `<th class="th-saldo-ant">Saldo Anterior</th>` : '';
        const thsGestiones = gestiones.map(g =>
            `<th class="th-gestion">${g.protegida ? `Protegida ${g.anio}` : (g.anio ?? '—')}</th>`
        ).join('');

        const tdSaldoAnterior = mostrarSaldoAnt
            ? `<td class="td-saldo-ant">
                    <span class="dias-badge dias-ant">${c.saldo_anterior} días</span>
                </td>` : '';
        const tdsGestiones = gestiones.map(g =>
            `<td>${g.saldo > 0
                ? `<span class="dias-badge dias-con-saldo">${g.saldo} días</span>`
                : `<span class="dias-badge dias-sin-saldo">0</span>`
            }</td>`
        ).join('');

        const badgeActual = c.es_actual
            ? `<span class="badge-actual"><i class="material-symbols-outlined">circle</i> Actual</span>` : '';
        const fechaFin    = c.fecha_fin
            ? formatearFecha(c.fecha_fin)
            : `<span class="badge-vigente">Vigente</span>`;

        const bloque = document.createElement('div');
        bloque.className = 'cargo-bloque' + (c.es_actual ? ' cargo-bloque-actual' : '');
        bloque.innerHTML = `
            <div class="cargo-bloque-header">
                <div class="cargo-bloque-info">
                    <span class="cargo-num">${idx + 1}</span>
                    <div>
                        <div class="cargo-nombre">${_escHtml(c.cargo)} ${badgeActual}</div>
                        <div class="cargo-meta">
                            <span>
                                <i class="material-symbols-outlined">calendar_month</i>
                                ${formatearFecha(c.fecha_inicio)} — ${fechaFin}
                            </span>
                        </div>
                    </div>
                </div>
                <div class="cargo-total-wrap">
                    <span class="cargo-total-label">Saldo Total</span>
                    <span class="dias-badge dias-total">${c.saldo_total} días</span>
                </div>
            </div>
            <div class="table-responsive" style="margin-top:0">
                <table class="tabla-cargo">
                    <thead><tr>${thSaldoAnterior}${thsGestiones}</tr></thead>
                    <tbody><tr>${tdSaldoAnterior}${tdsGestiones}</tr></tbody>
                </table>
            </div>`;
        container.appendChild(bloque);
    });
}

// ══════════════════════════════════════════════════════════════
//  LIMPIAR
// ══════════════════════════════════════════════════════════════
function limpiarFiltros() {
    document.getElementById('searchFuncionario').value           = '';
    document.getElementById('sugerenciasDropdown').style.display = 'none';
    document.getElementById('tableCard').style.display           = 'none';
    document.getElementById('placeholderCard').style.display     = 'block';
    document.getElementById('cargosContainer').innerHTML         = '';
    funcionarioSeleccionado = null;
    cargosDelFuncionario    = [];
}

// ══════════════════════════════════════════════════════════════
//  EXPORTAR PDF  —  misma paleta y encabezado que el resto de los
//  reportes del sistema (PDF_THEME, cargado por pdf-theme.js)
// ══════════════════════════════════════════════════════════════
function generarPlanillaPDF() {
    if (!funcionarioSeleccionado) return;

    const f = funcionarioSeleccionado;
    const total = cargosDelFuncionario.length;

    // ── Bloques por cargo ──────────────────────────────────────
    const bloquesPDF = cargosDelFuncionario.map((c, idx) => {
        const mostrarSaldoAnt = idx > 0;
        const fechaFinStr     = c.fecha_fin ? formatearFecha(c.fecha_fin) : 'Vigente';
        const gestiones       = c.gestiones.length ? c.gestiones : [{ anio: null, saldo: 0 }];

        const thSaldoAnt = mostrarSaldoAnt ? '<th>Saldo Anterior</th>' : '';
        const thsG = gestiones.map(g => `<th>${g.anio ? `${g.protegida ? 'Gestión Protegida' : 'Gestión'} ${g.anio}` : 'Gestiones'}</th>`).join('');
        const tdSaldoAnt = mostrarSaldoAnt ? `<td class="ant">${c.saldo_anterior} días</td>` : '';
        const tdsG = gestiones.map(g => `<td>${g.saldo} días</td>`).join('');

        return `
        <div class="bloque">
            <div class="bloque-header">
                <div class="bloque-titulo">${idx + 1}.&nbsp; ${_escHtml(c.cargo)}${c.es_actual ? '<span class="badge-actual">Actual · Vigente</span>' : ''}</div>
                <div class="bloque-periodo">Periodo: ${formatearFecha(c.fecha_inicio)} — ${fechaFinStr}</div>
            </div>
            <table class="tabla-cargo">
                <thead><tr>${thSaldoAnt}${thsG}<th class="col-total">Saldo Total</th></tr></thead>
                <tbody><tr>${tdSaldoAnt}${tdsG}<td class="col-total${c.es_actual ? ' actual' : ''}">${c.saldo_total} días</td></tr></tbody>
            </table>
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><style>${PDF_THEME.htmlCss}</style></head>
<body>
    ${PDF_THEME.htmlEncabezado(_escHtml(rolLabel), 'Historial de Cargos Anteriores')}
    ${PDF_THEME.htmlDatos([
        ['Funcionario', _escHtml(f.nombre_completo)],
        ['Cargo', _escHtml(f.cargo_actual)],
        ['Fecha de ingreso', formatearFecha(f.fecha_ingreso)],
        ['Total de Cargos', `${total} cargo${total !== 1 ? 's' : ''} (${Math.max(total - 1, 0)} anteriores)`],
    ])}
    <div class="seccion">Trayectoria de Cargos</div>
    ${bloquesPDF}
    <p class="nota">Los saldos por gestión se expresan en días de vacación. Cada cargo muestra solo las gestiones que le corresponden.</p>
</body></html>`;

    descargarPDFDesdeHTML(html, `HC-${nombreArchivoSeguro(f.nombre_completo)}.pdf`, 'portrait');
}

// ══════════════════════════════════════════════════════════════
//  UTILIDADES
// ══════════════════════════════════════════════════════════════
function _resaltar(html, q) {
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return html.replace(
        new RegExp(`(${safe})`, 'gi'),
        `<mark style="background:rgba(114,0,53,0.12);color:rgb(114,0,53);font-weight:800;border-radius:2px;padding:0 2px">$1</mark>`
    );
}

function _escHtml(s) {
    if (!s) return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatearFecha(fecha) {
    if (!fecha) return '—';
    const [a, m, d] = fecha.split('-');
    return `${d}/${m}/${a}`;
}
