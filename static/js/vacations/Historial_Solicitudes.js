// ══════════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ══════════════════════════════════════════════════════════════
const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]').content;
const URL_MIS_SOLICITUDES = '/api/vacaciones/mis-solicitudes/';

// ══════════════════════════════════════════════════════════════
//  ESTADO DEL MÓDULO
// ══════════════════════════════════════════════════════════════
let todasLasSolicitudes = [];
let tabActual           = 'todas';
let textoBusqueda       = '';
let nivelCols           = [];   // [{db_nivel, header, subtitle}] — dinámico por tipo_funcionario
let USUARIO_ACTUAL      = { nombre: '', ci: '' };
let resumenGlobal       = { total: 0, dias_usados: 0, dias_pendientes: 0, dias_adeudados: 0 };

// ══════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    _initPerfil();
    await cargarSolicitudes();

    const input = document.getElementById('searchInput');
    input.addEventListener('input', () => { textoBusqueda = input.value; renderizarTabla(); });
    input.addEventListener('keypress', e => { if (e.key === 'Enter') renderizarTabla(); });
    document.getElementById('btnSearch').addEventListener('click', renderizarTabla);
});

async function _initPerfil() {
    try {
        const resp = await fetch('/api/usuario/mi-perfil/', { headers: { 'X-CSRFToken': CSRF_TOKEN } });
        const data = await resp.json();
        if (!data.error) {
            window.initProfileSwitcher?.({ roles: data.roles, nombre: data.nombre_completo });
            window.setupProfileToggle?.();
        }
    } catch (e) {
        console.warn('Profile switcher no disponible:', e);
    }
}

// ══════════════════════════════════════════════════════════════
//  CARGA DESDE BACKEND
// ══════════════════════════════════════════════════════════════
async function cargarSolicitudes() {
    try {
        const resp = await fetch(URL_MIS_SOLICITUDES, { headers: { 'X-CSRFToken': CSRF_TOKEN } });
        const data = await resp.json();

        if (data.error) { console.error('Error del servidor:', data.error); return; }

        USUARIO_ACTUAL      = data.funcionario;
        resumenGlobal       = data.resumen;
        todasLasSolicitudes = data.solicitudes;
        nivelCols           = data.nivel_cols ?? [];

        construirCabecera();
        actualizarContadores();
        renderizarTabla();

    } catch (err) {
        console.error('Error al cargar solicitudes:', err);
    }
}

// ══════════════════════════════════════════════════════════════
//  CABECERA DINÁMICA (depende de tipo_funcionario via nivel_cols)
// ══════════════════════════════════════════════════════════════
function construirCabecera() {
    const nivelesHtml = nivelCols.map(c =>
        `<th>${c.header}<small>${c.subtitle}</small></th>`
    ).join('');

    document.getElementById('tableHead').innerHTML = `
        <tr>
            <th>Fecha Solicitud</th>
            <th>Periodo</th>
            <th>Días</th>
            <th>Motivo</th>
            <th>Estado</th>
            ${nivelesHtml}
            <th>Observaciones</th>
        </tr>`;
}

// ══════════════════════════════════════════════════════════════
//  TABS
// ══════════════════════════════════════════════════════════════
function cambiarTab(tabElement, tab) {
    tabActual = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tabElement.classList.add('active');
    renderizarTabla();
}

// ══════════════════════════════════════════════════════════════
//  CONTADORES (siempre sobre el total, sin aplicar búsqueda)
// ══════════════════════════════════════════════════════════════
function actualizarContadores() {
    document.getElementById('countTodas').textContent      = todasLasSolicitudes.length;
    document.getElementById('countAprobadas').textContent  = todasLasSolicitudes.filter(s => s.estado === 'Aprobada').length;
    document.getElementById('countRechazadas').textContent = todasLasSolicitudes.filter(s => s.estado === 'Rechazada').length;
    document.getElementById('countPendientes').textContent = todasLasSolicitudes.filter(s => s.estado === 'Pendiente').length;
}

// ══════════════════════════════════════════════════════════════
//  FILTRADO (tab + búsqueda combinados)
// ══════════════════════════════════════════════════════════════
function _getFiltradas() {
    const mapTab = { aprobada: 'Aprobada', rechazada: 'Rechazada', pendiente: 'Pendiente' };

    let arr = tabActual === 'todas'
        ? [...todasLasSolicitudes]
        : todasLasSolicitudes.filter(s => s.estado === mapTab[tabActual]);

    const q = textoBusqueda.trim().toLowerCase();
    if (q) {
        arr = arr.filter(s =>
            s.fecha_solicitud.includes(q) ||
            formatearFecha(s.fecha_solicitud).includes(q) ||
            s.estado.toLowerCase().includes(q)
        );
    }

    return arr.sort((a, b) => new Date(b.fecha_solicitud) - new Date(a.fecha_solicitud));
}

// ══════════════════════════════════════════════════════════════
//  RENDERIZAR TABLA
// ══════════════════════════════════════════════════════════════
function renderizarTabla() {
    const tbody     = document.getElementById('solicitudesBody');
    const filtradas = _getFiltradas();
    // 5 columnas fijas + columnas de nivel dinámicas + Observaciones
    const totalCols = 5 + nivelCols.length + 1;

    if (filtradas.length === 0) {
        const msg = tabActual !== 'todas'
            ? `No hay solicitudes ${tabActual}s`
            : 'No hay solicitudes registradas';
        tbody.innerHTML = `
            <tr>
                <td colspan="${totalCols}" style="padding:0">
                    <div class="empty-state">
                        <i class="material-symbols-outlined">event_busy</i>
                        <p>${msg}</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtradas.map(s => {
        const nivelesHtml = nivelCols.map(c =>
            `<td>${_celdaNivel(s[`nivel${c.db_nivel}`])}</td>`
        ).join('');

        const motivo = s.motivo.length > 45
            ? s.motivo.substring(0, 45) + '…'
            : s.motivo;

        const obs = s.observaciones
            ? `<span title="${_escHtml(s.observaciones)}">${
                s.observaciones.length > 42
                    ? _escHtml(s.observaciones.substring(0, 42)) + '…'
                    : _escHtml(s.observaciones)
              }</span>`
            : '<span class="nivel-pendiente">—</span>';

        return `
        <tr>
            <td>${formatearFecha(s.fecha_solicitud)}</td>
            <td>${formatearFecha(s.fecha_salida)} al ${formatearFecha(s.fecha_retorno)}</td>
            <td><strong>${s.dias}</strong> días</td>
            <td class="td-texto">${_escHtml(motivo)}</td>
            <td>${_badgeEstado(s.estado)}</td>
            ${nivelesHtml}
            <td class="td-texto">${obs}</td>
        </tr>`;
    }).join('');
}

function _celdaNivel(nivel) {
    if (!nivel) return '<span class="nivel-pendiente">—</span>';

    const icono = nivel.decision === 'APROBADO'
        ? '<i class="material-symbols-outlined nivel-icono aprobado">check_circle</i>'
        : '<i class="material-symbols-outlined nivel-icono rechazado">cancel</i>';

    return `
        <div class="nivel-aprobacion">
            <span class="nivel-nombre">${icono} ${_escHtml(nivel.nombre)}</span>
            <span class="nivel-fecha">${formatearFecha(nivel.fecha)}</span>
        </div>`;
}

function _badgeEstado(estado) {
    const clases = {
        Pendiente: 'estado-pendiente',
        Aprobada:  'estado-aprobada',
        Rechazada: 'estado-rechazada',
    };
    return `<span class="estado-badge ${clases[estado] ?? ''}">${estado}</span>`;
}

function _escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════════════════════════
//  PDF — planilla imprimible (columnas dinámicas)
// ══════════════════════════════════════════════════════════════
function generarPlanillaPDF() {
    const hoy = new Date();
    const fechaHoy = `${String(hoy.getDate()).padStart(2,'0')}/${String(hoy.getMonth()+1).padStart(2,'0')}/${hoy.getFullYear()}`;
    const { dias_usados, dias_pendientes, dias_adeudados } = resumenGlobal;
    const total = todasLasSolicitudes.length;

    const thNiveles = nivelCols.map(c =>
        `<th>${c.header}<br><span style="font-weight:400;font-size:0.85em">${c.subtitle}</span></th>`
    ).join('');

    const filas = todasLasSolicitudes.map((s, i) => {
        const nivelesHtml = nivelCols.map(c => {
            const n = s[`nivel${c.db_nivel}`];
            return n
                ? `<td style="text-align:center;font-size:0.82em">${_escHtml(n.nombre)}<br><small>${formatearFecha(n.fecha)}</small></td>`
                : `<td style="text-align:center"><span style="color:#bbb">—</span></td>`;
        }).join('');

        const colores = {
            Aprobada:  { color: '#1e8449', bg: '#eafaf1' },
            Rechazada: { color: '#c0392b', bg: '#fdedec' },
            Pendiente: { color: '#d68910', bg: '#fef9e7' },
        };
        const { color, bg } = colores[s.estado] ?? colores.Pendiente;

        return `
        <tr>
            <td style="text-align:center">${i + 1}</td>
            <td>${formatearFecha(s.fecha_solicitud)}</td>
            <td>${formatearFecha(s.fecha_salida)} al ${formatearFecha(s.fecha_retorno)}</td>
            <td style="text-align:center"><strong>${s.dias}</strong></td>
            <td style="text-align:left">${_escHtml(s.motivo)}</td>
            <td style="text-align:center">
                <span style="background:${bg};color:${color};padding:3px 10px;border-radius:12px;font-size:0.78em;font-weight:700;border:1px solid ${color}">${s.estado}</span>
            </td>
            ${nivelesHtml}
            <td style="text-align:left;font-size:0.82em">${s.observaciones ? _escHtml(s.observaciones) : '<span style="color:#bbb">—</span>'}</td>
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
    @page { size: A4 landscape; margin: 18mm 14mm; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #222; }
    .header { text-align: center; margin-bottom: 16px; }
    .header-inner { display:flex; align-items:center; justify-content:center; gap:16px; margin-bottom:8px; }
    .header h2 { font-size: 13px; font-weight: 800; color: rgb(39,20,71); margin-bottom: 2px; }
    .header h3 { font-size: 11px; font-weight: 700; color: rgb(114,0,53); margin-bottom: 4px; }
    .header p  { font-size: 10px; color: #555; }
    .resumen { display:flex; gap:18px; justify-content:center; margin-bottom:14px; flex-wrap:wrap; }
    .resumen-item { background:#f9f0f4; border:1px solid #e8c8d8; border-radius:8px; padding:6px 16px; text-align:center; }
    .resumen-item .val { font-size:16px; font-weight:800; color:rgb(114,0,53); display:block; }
    .resumen-item .lbl { font-size:9px; color:#888; font-weight:600; text-transform:uppercase; }
    table { width:100%; border-collapse:collapse; margin-bottom:18px; }
    thead { background:linear-gradient(90deg,rgb(39,20,71),rgb(114,0,53)); }
    th { color:#fff; padding:8px 7px; font-size:9px; font-weight:700; text-transform:uppercase; text-align:center; border-right:1px solid rgba(255,255,255,0.15); }
    th:last-child { border-right:none; }
    td { padding:7px 7px; border-bottom:1px solid #f0e6ec; vertical-align:middle; }
    tr:nth-child(even) td { background:#fdf6fa; }
    .footer { margin-top:24px; border-top:2px solid rgb(114,0,53); padding-top:14px; }
    .footer-row { display:flex; justify-content:space-between; align-items:flex-end; }
    .firma-line { border-top:1.5px solid #555; width:180px; margin:36px auto 4px; }
    .firma-label { font-size:9px; color:#555; font-weight:700; text-transform:uppercase; text-align:center; }
    .nota { font-size:9px; color:#888; font-style:italic; text-align:center; margin-top:10px; }
</style>
</head>
<body>
<div class="header">
    <div class="header-inner">
        <img src="/static/img/login/LOGOSSU.png" style="height:62px;width:auto;">
        <div>
            <h2>SEGURO SOCIAL UNIVERSITARIO</h2>
            <h3>RECURSOS HUMANOS</h3>
            <p>Trinidad, ${fechaHoy}</p>
        </div>
    </div>
    <p style="font-weight:700;font-size:12px;color:rgb(39,20,71);margin-top:6px">HISTORIAL DE SOLICITUDES DE VACACIONES</p>
    <p style="font-size:10px;color:rgb(114,0,53);font-weight:600">${_escHtml(USUARIO_ACTUAL.nombre)} &nbsp;·&nbsp; C.I. ${_escHtml(USUARIO_ACTUAL.ci)}</p>
</div>
<div class="resumen">
    <div class="resumen-item"><span class="val">${total}</span><span class="lbl">Total Solicitudes</span></div>
    <div class="resumen-item"><span class="val" style="color:#1e8449">${dias_usados}</span><span class="lbl">Días Usados</span></div>
    <div class="resumen-item"><span class="val" style="color:#d68910">${dias_pendientes}</span><span class="lbl">Días Pendientes</span></div>
    <div class="resumen-item"><span class="val" style="color:rgb(39,20,71)">${dias_adeudados}</span><span class="lbl">Saldo Disponible</span></div>
</div>
<table>
    <thead>
        <tr>
            <th>#</th>
            <th>Fecha Solicitud</th>
            <th>Período</th>
            <th>Días</th>
            <th>Motivo</th>
            <th>Estado</th>
            ${thNiveles}
            <th>Observaciones</th>
        </tr>
    </thead>
    <tbody>${filas}</tbody>
</table>
<div class="footer">
    <div class="footer-row">
        <div></div>
        <div>
            <div class="firma-line"></div>
            <div class="firma-label">Encargada de RR.HH.</div>
        </div>
    </div>
    <p class="nota">Documento generado el ${fechaHoy} — Sistema SSU</p>
</div>
</body>
</html>`;

    const ventana = window.open('', '_blank');
    ventana.document.write(html);
    ventana.document.close();
    ventana.focus();
    setTimeout(() => ventana.print(), 500);
}

// ══════════════════════════════════════════════════════════════
//  UTILIDAD: formato de fecha
// ══════════════════════════════════════════════════════════════
function formatearFecha(fecha) {
    if (!fecha) return '—';
    const [a, m, d] = fecha.split('-');
    return `${d}/${m}/${a}`;
}
