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
//  EXPORTAR PDF  —  misma paleta y encabezado que el resto de los
//  reportes del sistema (PDF_THEME, cargado por pdf-theme.js)
// ══════════════════════════════════════════════════════════════
function generarPlanillaPDF() {
    if (!funcionarioSeleccionado) return;

    const hoy      = new Date();
    const fechaHoy = `${String(hoy.getDate()).padStart(2,'0')}/${String(hoy.getMonth()+1).padStart(2,'0')}/${hoy.getFullYear()}`;
    const f        = funcionarioSeleccionado;
    const T        = PDF_THEME.html;

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
        <div class="bloque">
            <div class="bloque-header">
                <span>${idx + 1}. ${_escHtml(c.cargo)}${etiqueta}</span>
                <span>${formatearFecha(c.fecha_inicio)} — ${fechaFinStr}&nbsp;&nbsp;·&nbsp;&nbsp;Total ${c.saldo_total} días</span>
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
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap');
    @page { size: A4 portrait; margin: 22mm 20mm 18mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Montserrat', Arial, sans-serif; font-size: 10px; color: ${T.textNavyMuted}; background: #fff; padding: 36px 44px; }

    /* ── Encabezado institucional ── */
    .inst-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 22px;
        padding-bottom: 12px;
        border-bottom: 2px solid ${T.navy};
    }
    .inst-nombre {
        font-size: 13px;
        font-weight: 700;
        color: ${T.navy};
        text-transform: uppercase;
        line-height: 1.6;
    }
    .inst-fecha { font-size: 10px; color: ${T.grayDate}; text-align: right; line-height: 1.6; }

    .titulo { text-align: center; margin-bottom: 20px; }
    .titulo h2 {
        color: ${T.pink};
        font-size: 17px;
        font-weight: 800;
        letter-spacing: 1px;
        text-transform: uppercase;
    }

    /* ── Ficha del funcionario ── */
    .datos {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px 30px;
        background: #f4f5fb;
        border: 1px solid #e3e5ef;
        border-radius: 6px;
        padding: 12px 18px;
        margin-bottom: 20px;
    }
    .dato { display: flex; gap: 6px; align-items: baseline; }
    .dato-label {
        font-weight: 700;
        color: ${T.pink};
        font-size: 9px;
        text-transform: uppercase;
        min-width: 85px;
    }
    .dato-valor { font-weight: 600; color: ${T.navy}; font-size: 10px; }

    /* ── Bloque por cargo ── */
    .bloque { margin-bottom: 16px; }
    .bloque-header {
        background: ${T.headerFillLight};
        color: ${T.navy};
        padding: 7px 14px;
        border-radius: 6px 6px 0 0;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-weight: 700;
        font-size: 9.5px;
    }
    .bloque-header span:last-child { font-weight: 400; opacity: 0.7; white-space: nowrap; }

    table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
    thead th {
        background: ${T.headerFillLight};
        color: ${T.navy};
        padding: 7px 10px;
        text-align: center;
        font-weight: 700;
        text-transform: uppercase;
        border: 1px solid ${T.borderLight};
    }
    td { padding: 8px 10px; border: 1px solid ${T.borderLight}; text-align: center; }
    tbody tr:nth-child(even) td { background: ${T.rowFillEven}; }

    .th-ant { background: #cfd5ec; }
    .td-ant { background: ${T.rowFillEven}; }
    .cero   { color: ${T.grayLabel}; }

    /* ── Nota al pie ── */
    .nota {
        font-size: 8.5px;
        color: ${T.grayLabel};
        font-style: italic;
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid ${T.borderLight};
        line-height: 1.5;
    }

    /* ── Firma — fija al fondo de la página ── */
    .firma-seccion { position: fixed; bottom: 24mm; right: 20mm; text-align: center; }
    .firma-linea {
        border-top: 1.5px solid ${T.navy};
        width: 220px;
        margin: 40px auto 5px;
    }
    .firma-cargo {
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: ${T.navy};
    }

    /* ── Pie del documento — fijo al fondo ── */
    .pie-doc {
        position: fixed;
        bottom: 10mm;
        left: 20mm;
        right: 20mm;
        padding-top: 5px;
        border-top: 1px solid ${T.borderLight};
        display: flex;
        justify-content: space-between;
        font-size: 8px;
        color: ${T.pink};
        opacity: .7;
    }
</style>
</head>
<body>

<div class="inst-header">
    <div style="display:flex;align-items:center;gap:14px;">
        <img src="/static/img/login/LOGOSSU.png" style="height:54px;width:auto;">
        <div class="inst-nombre">SEGURO SOCIAL UNIVERSITARIO<br>
            <span style="font-weight:400;font-size:10px;color:${T.grayLabel};letter-spacing:.5px">${_escHtml(rolLabel)}</span>
        </div>
    </div>
    <div class="inst-fecha">Trinidad, ${fechaHoy}</div>
</div>

<div class="titulo"><h2>Historial de Cargos</h2></div>

<div class="datos">
    <div class="dato"><span class="dato-label">Funcionario:</span><span class="dato-valor">${_escHtml(f.nombre_completo)}</span></div>
    <div class="dato"><span class="dato-label">Cargo Actual:</span><span class="dato-valor">${_escHtml(f.cargo_actual)}</span></div>
    <div class="dato"><span class="dato-label">Fecha Ingreso:</span><span class="dato-valor">${formatearFecha(f.fecha_ingreso)}</span></div>
    <div class="dato"><span class="dato-label">Cargos:</span><span class="dato-valor">${cargosDelFuncionario.length}</span></div>
</div>

${bloquesPDF}

<p class="nota">
    El "Total días" de cada cargo es la suma de sus 2 gestiones propias únicamente.<br>
    El "Saldo Días Anterior" no se incluye en ese cálculo — se muestra como referencia de auditoría.
</p>

<div class="firma-seccion">
    <div class="firma-linea"></div>
    <div class="firma-cargo">${_escHtml(rolLabel)}</div>
</div>

<div class="pie-doc">
    <span>Sistema SSU — Historial de Cargos</span>
    <span>Generado el ${fechaHoy}</span>
</div>

</body>
</html>`;

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
