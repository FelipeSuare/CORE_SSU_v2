// ══════════════════════════════════════════════
// DATOS DE EJEMPLO
// ══════════════════════════════════════════════
const FUNCIONARIOS = [
    { id: 1, nombre: "Ana Alave Torres",         ci: "4203818", fechaIngreso: "2014-03-01" },
    { id: 2, nombre: "Carlos Alberto Vaca Ríos", ci: "3812045", fechaIngreso: "2016-01-15" },
    { id: 3, nombre: "María Elena Suárez Vidal", ci: "5029341", fechaIngreso: "2010-06-01" }
];

// saldoAnterior = días que trajo del cargo previo (0 si es el primero)
const TODOS_CARGOS = [
    // ── Ana Alave Torres ──
    {
        id: 1, funcionarioId: 1,
        cargo: "Auxiliar de Enfermería", area: "Salud", contrato: "Item",
        fechaInicio: "2014-03-01", fechaFin: "2017-08-31", esActual: false,
        saldoAnterior: 0,
        gestiones: [{ year: 2014, saldo: 8 }, { year: 2015, saldo: 15 }, { year: 2016, saldo: 5 }, { year: 2017, saldo: 0 }]
    },
    {
        id: 2, funcionarioId: 1,
        cargo: "Técnico en Enfermería", area: "Salud", contrato: "Contrato",
        fechaInicio: "2017-09-01", fechaFin: "2019-04-09", esActual: false,
        saldoAnterior: 28, // trajo 28 días de Auxiliar de Enfermería
        gestiones: [{ year: 2017, saldo: 12 }, { year: 2018, saldo: 20 }, { year: 2019, saldo: 3 }, { year: 2020, saldo: 0 }]
    },
    {
        id: 3, funcionarioId: 1,
        cargo: "Enfermera Profesional", area: "Salud", contrato: "Item",
        fechaInicio: "2019-04-10", fechaFin: null, esActual: true,
        saldoAnterior: 63, // 28 + 35 días de Técnico en Enfermería
        gestiones: [{ year: 2023, saldo: 10 }, { year: 2024, saldo: 5 }, { year: 2025, saldo: 15 }, { year: 2026, saldo: 0 }]
    },

    // ── Carlos Alberto Vaca Ríos ──
    {
        id: 4, funcionarioId: 2,
        cargo: "Asistente Administrativo", area: "Administrativa", contrato: "Eventual",
        fechaInicio: "2016-01-15", fechaFin: "2018-12-31", esActual: false,
        saldoAnterior: 0,
        gestiones: [{ year: 2016, saldo: 10 }, { year: 2017, saldo: 15 }, { year: 2018, saldo: 7 }, { year: 2019, saldo: 0 }]
    },
    {
        id: 5, funcionarioId: 2,
        cargo: "Secretario", area: "Administrativa", contrato: "Item",
        fechaInicio: "2019-01-02", fechaFin: "2020-06-14", esActual: false,
        saldoAnterior: 32, // trajo 32 días del cargo anterior
        gestiones: [{ year: 2019, saldo: 5 }, { year: 2020, saldo: 8 }, { year: 2021, saldo: 3 }, { year: 2022, saldo: 0 }]
    },
    {
        id: 6, funcionarioId: 2,
        cargo: "Auxiliar Administrativo", area: "Administrativa", contrato: "Item",
        fechaInicio: "2020-06-15", fechaFin: null, esActual: true,
        saldoAnterior: 48,
        gestiones: [{ year: 2023, saldo: 0 }, { year: 2024, saldo: 15 }, { year: 2025, saldo: 5 }, { year: 2026, saldo: 10 }]
    },

    // ── María Elena Suárez Vidal ──
    {
        id: 7, funcionarioId: 3,
        cargo: "Médico Rural", area: "Salud", contrato: "Consultor",
        fechaInicio: "2010-06-01", fechaFin: "2013-05-31", esActual: false,
        saldoAnterior: 0,
        gestiones: [{ year: 2010, saldo: 20 }, { year: 2011, saldo: 15 }, { year: 2012, saldo: 10 }, { year: 2013, saldo: 5 }]
    },
    {
        id: 8, funcionarioId: 3,
        cargo: "Médico Especialista", area: "Salud", contrato: "Item",
        fechaInicio: "2013-06-01", fechaFin: "2015-02-28", esActual: false,
        saldoAnterior: 50,
        gestiones: [{ year: 2013, saldo: 18 }, { year: 2014, saldo: 12 }, { year: 2015, saldo: 6 }, { year: 2016, saldo: 0 }]
    },
    {
        id: 9, funcionarioId: 3,
        cargo: "Médico General", area: "Salud", contrato: "Item",
        fechaInicio: "2015-03-01", fechaFin: null, esActual: true,
        saldoAnterior: 86,
        gestiones: [{ year: 2023, saldo: 3 }, { year: 2024, saldo: 12 }, { year: 2025, saldo: 6 }, { year: 2026, saldo: 20 }]
    }
];

// ══════════════════════════════════════════════
// ESTADO
// ══════════════════════════════════════════════
let funcionarioSeleccionado = null;
let cargosDelFuncionario    = [];

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
    document.addEventListener("click", e => {
        if (!e.target.closest(".search-box")) {
            document.getElementById("sugerenciasDropdown").style.display = "none";
        }
    });
    document.getElementById("searchFuncionario").addEventListener("keypress", e => {
        if (e.key === "Enter") buscarFuncionarioManual();
    });
});

// ══════════════════════════════════════════════
// AUTOCOMPLETE
// ══════════════════════════════════════════════
function mostrarSugerencias() {
    const texto    = document.getElementById("searchFuncionario").value.trim().toLowerCase();
    const dropdown = document.getElementById("sugerenciasDropdown");
    if (texto.length < 2) { dropdown.style.display = "none"; return; }

    const hits = FUNCIONARIOS.filter(f => f.nombre.toLowerCase().includes(texto));
    if (!hits.length) {
        dropdown.innerHTML = `<div class="sug-item sug-empty"><i class="material-symbols-outlined">person_off</i> No se encontró funcionario</div>`;
        dropdown.style.display = "block";
        return;
    }
    dropdown.innerHTML = hits.map(f => `
        <div class="sug-item" onclick="seleccionarFuncionario(${f.id})">
            <i class="material-symbols-outlined sug-icon">person</i>
            <div>
                <div class="sug-nombre">${resaltarTexto(f.nombre, texto)}</div>
                <div class="sug-ci">C.I. ${f.ci}</div>
            </div>
        </div>`).join('');
    dropdown.style.display = "block";
}

function resaltarTexto(texto, busqueda) {
    const r = new RegExp(`(${busqueda})`, 'gi');
    return texto.replace(r, `<mark style="background:rgba(114,0,53,0.12);color:rgb(114,0,53);font-weight:800;border-radius:2px;padding:0 2px">$1</mark>`);
}

function buscarFuncionarioManual() {
    const texto = document.getElementById("searchFuncionario").value.trim().toLowerCase();
    const hit   = FUNCIONARIOS.find(f => f.nombre.toLowerCase().includes(texto));
    if (hit) seleccionarFuncionario(hit.id);
}

function seleccionarFuncionario(id) {
    const f = FUNCIONARIOS.find(f => f.id === id);
    document.getElementById("searchFuncionario").value = f.nombre;
    document.getElementById("sugerenciasDropdown").style.display = "none";
    cargarFuncionario(id);
}

// ══════════════════════════════════════════════
// CARGAR FUNCIONARIO
// ══════════════════════════════════════════════
function cargarFuncionario(id) {
    funcionarioSeleccionado = FUNCIONARIOS.find(f => f.id === id);
    cargosDelFuncionario    = TODOS_CARGOS
        .filter(c => c.funcionarioId === id)
        .sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));

    document.getElementById("tableCard").style.display       = "block";
    document.getElementById("placeholderCard").style.display = "none";

    renderizarBanner();
    actualizarResumen();
    renderizarCargos();
}

// ══════════════════════════════════════════════
// BANNER
// ══════════════════════════════════════════════
function renderizarBanner() {
    const f          = funcionarioSeleccionado;
    const cargoActual = cargosDelFuncionario.find(c => c.esActual);
    document.getElementById("funcionarioBanner").innerHTML = `
        <div class="func-avatar"><i class="material-symbols-outlined">person</i></div>
        <div class="func-info">
            <div class="func-nombre">${f.nombre}</div>
            <div class="func-meta">
                ${cargoActual ? `<span><i class="material-symbols-outlined">work</i> Cargo actual: ${cargoActual.cargo}</span>` : ''}
                <span><i class="material-symbols-outlined">calendar_month</i> Ingreso: ${formatearFecha(f.fechaIngreso)}</span>
            </div>
        </div>`;
}

// ══════════════════════════════════════════════
// RESUMEN
// ══════════════════════════════════════════════
function actualizarResumen() {
    const total     = cargosDelFuncionario.length;
    const anteriores = cargosDelFuncionario.filter(c => !c.esActual).length;
    document.getElementById("subtituloResumen").innerHTML = `
        <span class="resumen-inline">
            <span class="resumen-item-cargos">
                <i class="material-symbols-outlined">work</i> ${total} cargo${total !== 1 ? 's' : ''} (${anteriores} anteriores)
            </span>
        </span>`;
}

// ══════════════════════════════════════════════
// RENDERIZAR: una mini-tabla por cargo
// ══════════════════════════════════════════════
function renderizarCargos() {
    const container = document.getElementById("cargosContainer");
    container.innerHTML = '';

    cargosDelFuncionario.forEach((c, idx) => {
        const tieneSaldoAnterior = c.saldoAnterior > 0;
        const saldoGestiones     = c.gestiones.reduce((a, g) => a + g.saldo, 0);
        const saldoTotal         = c.saldoAnterior + saldoGestiones;

        // ── Headers ──
        const thSaldoAnterior = tieneSaldoAnterior
            ? `<th class="th-saldo-ant">Saldo Anterior</th>`
            : '';
        const thsGestiones = c.gestiones.map(g =>
            `<th class="th-gestion">${g.year}</th>`
        ).join('');

        // ── Celdas ──
        const tdSaldoAnterior = tieneSaldoAnterior
            ? `<td class="td-saldo-ant"><span class="dias-badge dias-ant">${c.saldoAnterior} días</span></td>`
            : '';
        const tdsGestiones = c.gestiones.map(g =>
            `<td>${g.saldo > 0
                ? `<span class="dias-badge dias-con-saldo">${g.saldo} días</span>`
                : `<span class="dias-badge dias-sin-saldo">0</span>`
            }</td>`
        ).join('');

        // ── Badge estado ──
        const badgeEstado = c.esActual
            ? `<span class="badge-actual"><i class="material-symbols-outlined">circle</i> Actual</span>`
            : '';

        const bloque = document.createElement('div');
        bloque.className = 'cargo-bloque' + (c.esActual ? ' cargo-bloque-actual' : '');
        bloque.innerHTML = `
            <div class="cargo-bloque-header">
                <div class="cargo-bloque-info">
                    <span class="cargo-num">${idx + 1}</span>
                    <div>
                        <div class="cargo-nombre">${c.cargo} ${badgeEstado}</div>
                        <div class="cargo-meta">
                            <span><i class="material-symbols-outlined">calendar_month</i> ${formatearFecha(c.fechaInicio)} — ${c.fechaFin ? formatearFecha(c.fechaFin) : '<span class="badge-vigente">Vigente</span>'}</span>
                        </div>
                    </div>
                </div>
                <div class="cargo-total-wrap">
                    <span class="cargo-total-label">Saldo Total</span>
                    <span class="dias-badge dias-total">${saldoTotal} días</span>
                </div>
            </div>
            <div class="table-responsive" style="margin-top:0">
                <table class="tabla-cargo">
                    <thead>
                        <tr>
                            ${thSaldoAnterior}
                            ${thsGestiones}
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            ${tdSaldoAnterior}
                            ${tdsGestiones}
                        </tr>
                    </tbody>
                </table>
            </div>`;
        container.appendChild(bloque);
    });
}

// ══════════════════════════════════════════════
// BADGES Y UTILIDADES
// ══════════════════════════════════════════════
function badgeContrato(tipo) {
    const mapa = { 'Item': 'contrato-item', 'Contrato': 'contrato-contrato', 'Eventual': 'contrato-eventual', 'Consultor': 'contrato-consultor' };
    return `<span class="contrato-badge ${mapa[tipo] || 'contrato-item'}">${tipo}</span>`;
}

function formatearFecha(fecha) {
    if (!fecha) return '—';
    const [a, m, d] = fecha.split('-');
    return `${d}/${m}/${a}`;
}

// ══════════════════════════════════════════════
// LIMPIAR
// ══════════════════════════════════════════════
function limpiarFiltros() {
    document.getElementById("searchFuncionario").value       = "";
    document.getElementById("sugerenciasDropdown").style.display = "none";
    document.getElementById("tableCard").style.display       = "none";
    document.getElementById("placeholderCard").style.display = "block";
    document.getElementById("cargosContainer").innerHTML     = "";
    funcionarioSeleccionado = null;
    cargosDelFuncionario    = [];
}

// ══════════════════════════════════════════════
// EXPORTAR PDF
// ══════════════════════════════════════════════
function generarPlanillaPDF() {
    if (!funcionarioSeleccionado) return;
    const hoy      = new Date();
    const fechaHoy = `${String(hoy.getDate()).padStart(2,'0')}/${String(hoy.getMonth()+1).padStart(2,'0')}/${hoy.getFullYear()}`;
    const f        = funcionarioSeleccionado;
    const cargoActual = cargosDelFuncionario.find(c => c.esActual);

    const bloquesPDF = cargosDelFuncionario.map((c, idx) => {
        const tieneSaldoAnterior = c.saldoAnterior > 0;
        const saldoTotal         = c.saldoAnterior + c.gestiones.reduce((a, g) => a + g.saldo, 0);
        const contratoColor = { 'Item': '#1e8449', 'Contrato': '#1a6fa3', 'Eventual': '#7d3c98', 'Consultor': '#b7770d' }[c.contrato] || '#555';
        const contratoBg    = { 'Item': '#eafaf1', 'Contrato': '#eaf4fb', 'Eventual': '#f5eefa', 'Consultor': '#fef9e7' }[c.contrato] || '#f5f5f5';

        const thSaldoAnt = tieneSaldoAnterior ? `<th style="background:#fff8e1;color:#b7770d;border:1px solid #f0d060">Saldo Anterior</th>` : '';
        const thsG       = c.gestiones.map(g => `<th>${g.year}</th>`).join('');
        const tdSaldoAnt = tieneSaldoAnterior
            ? `<td style="text-align:center"><span style="background:#fff8e1;color:#b7770d;padding:2px 8px;border-radius:10px;font-weight:700;border:1px solid #f0d060">${c.saldoAnterior} días</span></td>`
            : '';
        const tdsG = c.gestiones.map(g => `
            <td style="text-align:center">${g.saldo > 0
                ? `<span style="background:#fdeef4;color:rgb(114,0,53);padding:2px 8px;border-radius:10px;font-weight:700;border:1px solid rgba(114,0,53,0.2)">${g.saldo} días</span>`
                : `<span style="color:#ccc">0</span>`
            }</td>`).join('');

        return `
        <div style="margin-bottom:20px;border:1px solid #eee;border-radius:8px;overflow:hidden;${c.esActual ? 'border-color:#aabbff' : ''}">
            <div style="background:${c.esActual ? 'linear-gradient(90deg,#3a5bbf,#5b3abf)' : 'linear-gradient(90deg,rgb(39,20,71),rgb(114,0,53))'};padding:8px 14px;display:flex;justify-content:space-between;align-items:center">
                <div>
                    <span style="color:#fff;font-weight:700;font-size:11px">${idx+1}. ${c.cargo}${c.esActual ? ' — ACTUAL' : ''}</span>
                    <span style="color:rgba(255,255,255,0.7);font-size:9px;margin-left:10px">${c.area} · ${formatearFecha(c.fechaInicio)} — ${c.fechaFin ? formatearFecha(c.fechaFin) : 'Vigente'}</span>
                </div>
                <span style="background:rgba(255,255,255,0.15);color:#fff;padding:2px 10px;border-radius:10px;font-weight:800;font-size:11px">Total: ${saldoTotal} días</span>
            </div>
            <table style="width:100%;border-collapse:collapse">
                <thead style="background:#f8f0f5">
                    <tr>
                        ${thSaldoAnt}
                        ${thsG}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        ${tdSaldoAnt}
                        ${tdsG}
                    </tr>
                </tbody>
            </table>
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
    @page { size: A4 portrait; margin: 16mm 14mm; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #222; }
    .header { text-align:center; margin-bottom:14px; }
    .header h2 { font-size:13px; font-weight:800; color:rgb(39,20,71); margin-bottom:2px; }
    .header h3 { font-size:11px; font-weight:700; color:rgb(114,0,53); margin-bottom:4px; }
    .func-banner { background:linear-gradient(90deg,rgb(39,20,71),rgb(114,0,53)); color:#fff; border-radius:8px; padding:10px 16px; margin-bottom:14px; }
    .func-banner .nombre { font-weight:800; font-size:12px; }
    .func-banner .meta   { font-size:9.5px; opacity:0.8; margin-top:3px; }
    table { width:100%; border-collapse:collapse; }
    th { color:#333; padding:6px 10px; font-size:9px; font-weight:700; text-align:center; border-bottom:1px solid #eee; }
    td { padding:7px 10px; font-size:10px; text-align:center; }
    .footer { margin-top:24px; border-top:2px solid rgb(114,0,53); padding-top:14px; display:flex; justify-content:flex-end; }
    .firma-block { text-align:center; }
    .firma-line  { border-top:1.5px solid #555; width:180px; margin:36px auto 4px; }
    .firma-label { font-size:9px; color:#555; font-weight:700; text-transform:uppercase; }
    .nota { font-size:9px; color:#888; font-style:italic; text-align:center; margin-top:10px; }
</style>
</head><body>
<div class="header">
    <h2>SERVICIO DEPARTAMENTAL DE SALUD</h2>
    <h3>RECURSOS HUMANOS — AUDITORÍA</h3>
    <p>Trinidad, ${fechaHoy}</p>
    <p style="font-weight:700;font-size:12px;color:rgb(39,20,71);margin-top:6px">HISTORIAL DE CARGOS — SALDO DE VACACIONES</p>
</div>
<div class="func-banner">
    <div class="nombre">${f.nombre}</div>
    <div class="meta">Cargo actual: ${cargoActual ? cargoActual.cargo : '—'} &nbsp;|&nbsp; Ingreso: ${formatearFecha(f.fechaIngreso)}</div>
</div>
${bloquesPDF}
<div class="footer">
    <div class="firma-block">
        <div class="firma-line"></div>
        <div class="firma-label">Encargada de RR.HH.</div>
    </div>
</div>
<p class="nota">Documento generado el ${fechaHoy} — Sistema SSU · "Saldo Anterior" = días acumulados del cargo previo</p>
</body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
}
