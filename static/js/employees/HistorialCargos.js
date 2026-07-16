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

        const thSaldoAnterior = mostrarSaldoAnt
            ? `<th class="th-saldo-ant">Saldo Anterior</th>` : '';
        const thsGestiones = c.gestiones.map(g =>
            `<th class="th-gestion">${g.anio ?? '—'}</th>`
        ).join('');

        const tdSaldoAnterior = mostrarSaldoAnt
            ? `<td class="td-saldo-ant">
                    <span class="dias-badge dias-ant">${c.saldo_anterior} días</span>
                </td>` : '';
        const tdsGestiones = c.gestiones.map(g =>
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
//  EXPORTAR PDF  —  diseño limpio de documento institucional
// ══════════════════════════════════════════════════════════════
function generarPlanillaPDF() {
    if (!funcionarioSeleccionado) return;

    const hoy      = new Date();
    const fechaHoy = `${String(hoy.getDate()).padStart(2,'0')}/${String(hoy.getMonth()+1).padStart(2,'0')}/${hoy.getFullYear()}`;
    const f        = funcionarioSeleccionado;

    // ── Bloques por cargo ──────────────────────────────────────
    const bloquesPDF = cargosDelFuncionario.map((c, idx) => {
        const mostrarSaldoAnt = idx > 0;
        const fechaFinStr     = c.fecha_fin ? formatearFecha(c.fecha_fin) : 'Vigente';
        const etiqueta        = c.es_actual ? '  [VIGENTE]' : '';

        const thSaldoAnt = mostrarSaldoAnt
            ? `<th class="th-ant">Saldo Días<br>Anterior</th>` : '';
        const thsG = c.gestiones.map(g => `<th>${g.anio ?? '—'}</th>`).join('');

        const tdSaldoAnt = mostrarSaldoAnt
            ? `<td class="td-ant">${c.saldo_anterior > 0 ? `<b>${c.saldo_anterior}</b> días` : '0'}</td>` : '';
        const tdsG = c.gestiones.map(g =>
            `<td>${g.saldo > 0 ? `<b>${g.saldo}</b> días` : '<span class="cero">0</span>'}</td>`
        ).join('');

        return `
        <div class="cargo-bloque">
            <div class="cargo-header">
                <div class="cargo-header-left">
                    <span class="cargo-num">${idx + 1}.</span>
                    <div>
                        <div class="cargo-titulo">${_escHtml(c.cargo)}${etiqueta}</div>
                        <div class="cargo-periodo">${formatearFecha(c.fecha_inicio)} — ${fechaFinStr}</div>
                    </div>
                </div>
                <div class="cargo-total-col">
                    <span class="total-etiq">Total días</span>
                    <span class="total-num">${c.saldo_total}</span>
                </div>
            </div>
            <table>
                <thead><tr>${thSaldoAnt}${thsG}</tr></thead>
                <tbody><tr>${tdSaldoAnt}${tdsG}</tr></tbody>
            </table>
        </div>`;
    }).join('');

    // ── HTML del documento ─────────────────────────────────────
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
    @page  { size: A4 portrait; margin: 22mm 20mm 18mm; }
    *      { box-sizing: border-box; margin: 0; padding: 0; }
    body   { font-family: 'Montserrat', Arial, sans-serif; font-size: 10.5px; color: #111; }

    /* ── Encabezado ── */
    .cabecera {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-bottom: 10px;
        border-bottom: 2px solid rgb(39,20,71);
        margin-bottom: 14px;
    }
    .cab-left {
        display: flex;
        align-items: center;
        gap: 14px;
    }
    .cab-logo { height: 52px; width: auto; }
    .cab-institucion {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: rgb(39,20,71);
    }
    .cab-area {
        font-size: 9px;
        color: rgb(114,0,53);
        margin-top: 2px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        font-weight: 600;
    }
    .cab-titulo {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1.2px;
        margin-top: 6px;
        color: rgb(39,20,71);
        border-bottom: 1px solid rgb(39,20,71);
        display: inline-block;
        padding-bottom: 1px;
    }
    .cab-right { text-align: right; }
    .cab-fecha {
        font-size: 9px;
        color: #555;
    }

    /* ── Ficha del funcionario ── */
    .ficha {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 16px;
        border: 1px solid #e0c8d4;
        background: #fdf5f8;
    }
    .ficha td {
        padding: 6px 10px;
        border-right: 1px solid #e0c8d4;
        vertical-align: top;
    }
    .ficha td:last-child { border-right: none; }
    .ficha-etiq {
        font-size: 8px;
        font-weight: 700;
        text-transform: uppercase;
        color: rgb(114,0,53);
        letter-spacing: 0.4px;
        display: block;
        margin-bottom: 2px;
    }
    .ficha-val {
        font-size: 10.5px;
        font-weight: 600;
        color: rgb(39,20,71);
    }

    /* ── Bloque por cargo ── */
    .cargo-bloque {
        border: 1px solid #e0c8d4;
        margin-bottom: 10px;
    }
    .cargo-header {
        background: linear-gradient(90deg, rgb(39,20,71), rgb(114,0,53));
        padding: 6px 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
    }
    .cargo-header-left {
        display: flex;
        align-items: baseline;
        gap: 5px;
    }
    .cargo-num   { font-weight: 700; font-size: 11px; white-space: nowrap; color: #fff; }
    .cargo-titulo {
        font-weight: 700;
        font-size: 10.5px;
        white-space: nowrap;
        color: #fff;
    }
    .cargo-periodo {
        font-size: 9px;
        color: rgba(255,255,255,.75);
        margin-top: 2px;
    }
    .cargo-total-col { text-align: right; white-space: nowrap; }
    .total-etiq {
        font-size: 8px;
        text-transform: uppercase;
        color: rgba(255,255,255,.75);
        letter-spacing: 0.3px;
        display: block;
    }
    .total-num { font-size: 14px; font-weight: 700; color: #fff; }

    /* ── Tabla gestiones ── */
    table { width: 100%; border-collapse: collapse; }
    thead { background: linear-gradient(90deg, rgb(39,20,71), rgb(114,0,53)); }
    th {
        padding: 5px 10px;
        font-size: 9px;
        font-weight: 700;
        text-align: center;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        border-right: 1px solid rgba(255,255,255,.15);
        color: #fff;
    }
    th:last-child { border-right: none; }
    td {
        padding: 7px 10px;
        font-size: 10px;
        text-align: center;
        border-bottom: 1px solid #f0e6ec;
    }
    tbody tr:nth-child(even) td { background: #fdf6fa; }

    .th-ant { background: rgba(0,0,0,.08); }
    .td-ant { background: rgba(114,0,53,.04); }
    .cero   { color: #ccc; }

    /* ── Nota al pie ── */
    .nota {
        font-size: 8.5px;
        color: #888;
        font-style: italic;
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid #e0c8d4;
        line-height: 1.5;
    }

    /* ── Firma — fija al fondo de la página ── */
    .firma-seccion {
        position: fixed;
        bottom: 24mm;
        right: 20mm;
    }
    .firma-bloque { text-align: center; }
    .firma-linea  {
        border-top: 1.5px solid rgb(39,20,71);
        width: 220px;
        margin: 40px auto 5px;
    }
    .firma-cargo {
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: rgb(39,20,71);
    }

    /* ── Pie del documento — fijo al fondo ── */
    .pie-doc {
        position: fixed;
        bottom: 10mm;
        left: 20mm;
        right: 20mm;
        padding-top: 5px;
        border-top: 1px solid #e0c8d4;
        display: flex;
        justify-content: space-between;
        font-size: 8px;
        color: rgb(114,0,53);
        opacity: .7;
    }
</style>
</head>
<body>

<div class="cabecera">
    <div class="cab-left">
        <img class="cab-logo" src="/static/img/login/LOGOSSU.png">
        <div>
            <div class="cab-institucion">Seguro Social Universitario</div>
            <div class="cab-area">${rolLabel}</div>
            <div class="cab-titulo">Historial de Cargos</div>
        </div>
    </div>
    <div class="cab-right">
        <div class="cab-fecha">Trinidad, ${fechaHoy}</div>
    </div>
</div>

<table class="ficha">
    <tr>
        <td style="width:45%">
            <span class="ficha-etiq">Funcionario</span>
            <span class="ficha-val">${_escHtml(f.nombre_completo)}</span>
        </td>
        <td style="width:35%">
            <span class="ficha-etiq">Cargo Actual</span>
            <span class="ficha-val">${_escHtml(f.cargo_actual)}</span>
        </td>
        <td style="width:20%">
            <span class="ficha-etiq">Fecha de Ingreso</span>
            <span class="ficha-val">${formatearFecha(f.fecha_ingreso)}</span>
        </td>
    </tr>
</table>

${bloquesPDF}

<p class="nota">
    El "Total días" de cada cargo es la suma de sus 2 gestiones propias únicamente.<br>
    El "Saldo Días Anterior" no se incluye en ese cálculo — se muestra como referencia de auditoría.
</p>

<div class="firma-seccion">
    <div class="firma-bloque">
        <div class="firma-linea"></div>
        <div class="firma-cargo">${rolLabel}</div>
    </div>
</div>

<div class="pie-doc">
    <span>Sistema SSU — Historial de Cargos</span>
    <span>Generado el ${fechaHoy}</span>
</div>

</body>
</html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
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
