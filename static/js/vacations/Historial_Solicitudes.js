// ══════════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ══════════════════════════════════════════════════════════════
const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]').content;
const URL_MIS_SOLICITUDES = '/api/vacaciones/mis-solicitudes/';

// ══════════════════════════════════════════════════════════════
//  ESTADO DEL MÓDULO
// ══════════════════════════════════════════════════════════════
let todasLasSolicitudes = [];
let misSolicitudes      = [];
let tabActual           = 'todas';
let USUARIO_ACTUAL      = { nombre: '', ci: '' };
let resumenGlobal       = { total: 0, dias_usados: 0, dias_pendientes: 0, dias_adeudados: 0 };

// ══════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    // Inicializar profile switcher compartido
    _initPerfil();

    await cargarSolicitudes();

    document.getElementById('searchInput').addEventListener('input', filtrarTabla);
    document.getElementById('searchInput').addEventListener('keypress', e => {
        if (e.key === 'Enter') filtrarTabla();
    });
    document.querySelector('.btn-search').addEventListener('click', filtrarTabla);
});

async function _initPerfil() {
    try {
        const resp = await fetch('/api/usuario/mi-perfil/', {
            headers: { 'X-CSRFToken': CSRF_TOKEN },
        });
        const data = await resp.json();
        if (data.error) return;
        window.initProfileSwitcher?.({ roles: data.roles, nombre: data.nombre_completo });
        window.setupProfileToggle?.();
    } catch (e) {
        console.warn('Profile switcher no disponible:', e);
    }
}

// ══════════════════════════════════════════════════════════════
//  CARGA DESDE BACKEND
// ══════════════════════════════════════════════════════════════
async function cargarSolicitudes() {
    try {
        const resp = await fetch(URL_MIS_SOLICITUDES, {
            headers: { 'X-CSRFToken': CSRF_TOKEN },
        });
        const data = await resp.json();

        if (data.error) {
            console.error('Error del servidor:', data.error);
            return;
        }

        USUARIO_ACTUAL  = data.funcionario;
        resumenGlobal   = data.resumen;
        todasLasSolicitudes = data.solicitudes;
        misSolicitudes      = [...todasLasSolicitudes];

        renderizarTabla();
        actualizarContadores();
        actualizarResumenInline();

    } catch (err) {
        console.error('Error al cargar solicitudes:', err);
    }
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
//  CONTADORES
// ══════════════════════════════════════════════════════════════
function actualizarContadores() {
    document.getElementById('countTodas').textContent      = todasLasSolicitudes.length;
    document.getElementById('countAprobadas').textContent  = todasLasSolicitudes.filter(s => s.estado === 'Aprobada').length;
    document.getElementById('countRechazadas').textContent = todasLasSolicitudes.filter(s => s.estado === 'Rechazada').length;
    document.getElementById('countPendientes').textContent = todasLasSolicitudes.filter(s => s.estado === 'Pendiente').length;
}

// ══════════════════════════════════════════════════════════════
//  RESUMEN INLINE
// ══════════════════════════════════════════════════════════════
function actualizarResumenInline() {
    const { dias_usados, dias_pendientes, dias_adeudados } = resumenGlobal;
    document.getElementById('subtituloResumen').innerHTML = `
        <span class="resumen-inline">
            <span class="resumen-item-usados">
                <i class="material-symbols-outlined">check_circle</i> ${dias_usados} usados
            </span>
            <span class="resumen-sep">·</span>
            <span class="resumen-item-pend">
                <i class="material-symbols-outlined">schedule</i> ${dias_pendientes} pendientes
            </span>
            <span class="resumen-sep">·</span>
            <span class="resumen-item-rest">
                <i class="material-symbols-outlined">calendar_month</i> ${dias_adeudados} disponibles
            </span>
        </span>`;
}

// ══════════════════════════════════════════════════════════════
//  RENDERIZAR TABLA
// ══════════════════════════════════════════════════════════════
function renderizarTabla() {
    const tbody = document.getElementById('solicitudesBody');

    let filtradas = todasLasSolicitudes;
    if (tabActual !== 'todas') {
        const map = { aprobada: 'Aprobada', rechazada: 'Rechazada', pendiente: 'Pendiente' };
        filtradas = todasLasSolicitudes.filter(s => s.estado === map[tabActual]);
    }

    filtradas = [...filtradas].sort(
        (a, b) => new Date(b.fecha_solicitud) - new Date(a.fecha_solicitud)
    );

    if (filtradas.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="padding:0">
                    <div class="empty-state">
                        <i class="material-symbols-outlined">event_busy</i>
                        <p>No hay solicitudes ${tabActual !== 'todas' ? tabActual + 's' : 'registradas'}</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtradas.map(s => `
        <tr>
            <td>${formatearFecha(s.fecha_solicitud)}</td>
            <td>${formatearFecha(s.fecha_salida)} al ${formatearFecha(s.fecha_retorno)}</td>
            <td><strong>${s.dias}</strong> días</td>
            <td style="text-align:left;max-width:160px;white-space:normal">
                ${s.motivo.length > 45 ? s.motivo.substring(0, 45) + '…' : s.motivo}
            </td>
            <td>${badgeEstado(s.estado)}</td>
            <td>${celdaNivel(s.nivel1)}</td>
            <td>${celdaNivel(s.nivel2)}</td>
            <td>${celdaNivel(s.nivel3)}</td>
            <td style="text-align:left;max-width:140px;white-space:normal">
                ${s.observaciones || '<span style="color:#ccc">—</span>'}
            </td>
        </tr>
    `).join('');
}

function celdaNivel(nivel) {
    if (!nivel) return '<span class="nivel-pendiente">—</span>';
    return `
        <div class="nivel-aprobacion">
            <span class="nivel-nombre">${nivel.nombre}</span>
            <span class="nivel-fecha">${formatearFecha(nivel.fecha)}</span>
        </div>`;
}

function badgeEstado(estado) {
    const clases = {
        Pendiente: 'estado-pendiente',
        Aprobada:  'estado-aprobada',
        Rechazada: 'estado-rechazada',
    };
    return `<span class="estado-badge ${clases[estado] || ''}">${estado}</span>`;
}

// ══════════════════════════════════════════════════════════════
//  BÚSQUEDA
// ══════════════════════════════════════════════════════════════
function filtrarTabla() {
    const texto = document.getElementById('searchInput').value.toLowerCase();
    document.querySelectorAll('#solicitudesBody tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(texto) ? '' : 'none';
    });
}

// ══════════════════════════════════════════════════════════════
//  EXPORTAR PDF (planilla imprimible)
// ══════════════════════════════════════════════════════════════
function generarPlanillaPDF() {
    const hoy = new Date();
    const fechaHoy = `${String(hoy.getDate()).padStart(2,'0')}/${String(hoy.getMonth()+1).padStart(2,'0')}/${hoy.getFullYear()}`;

    const { dias_usados, dias_pendientes } = resumenGlobal;
    const total = todasLasSolicitudes.length;

    const filas = todasLasSolicitudes.map((s, i) => {
        const n1 = s.nivel1
            ? `${s.nivel1.nombre}<br><small>${formatearFecha(s.nivel1.fecha)}</small>`
            : '<span style="color:#bbb">—</span>';
        const n2 = s.nivel2
            ? `${s.nivel2.nombre}<br><small>${formatearFecha(s.nivel2.fecha)}</small>`
            : '<span style="color:#bbb">—</span>';
        const n3 = s.nivel3
            ? `${s.nivel3.nombre}<br><small>${formatearFecha(s.nivel3.fecha)}</small>`
            : '<span style="color:#bbb">—</span>';

        const colores = {
            Aprobada:  { color: '#1e8449', bg: '#eafaf1' },
            Rechazada: { color: '#c0392b', bg: '#fdedec' },
            Pendiente: { color: '#d68910', bg: '#fef9e7' },
        };
        const { color, bg } = colores[s.estado] || colores.Pendiente;

        return `
        <tr>
            <td style="text-align:center">${i + 1}</td>
            <td>${formatearFecha(s.fecha_solicitud)}</td>
            <td>${formatearFecha(s.fecha_salida)} al ${formatearFecha(s.fecha_retorno)}</td>
            <td style="text-align:center"><strong>${s.dias}</strong></td>
            <td style="text-align:left">${s.motivo}</td>
            <td style="text-align:center">
                <span style="background:${bg};color:${color};padding:3px 10px;border-radius:12px;font-size:0.78em;font-weight:700;border:1px solid ${color}">${s.estado}</span>
            </td>
            <td style="text-align:center;font-size:0.82em">${n1}</td>
            <td style="text-align:center;font-size:0.82em">${n2}</td>
            <td style="text-align:center;font-size:0.82em">${n3}</td>
            <td style="text-align:left;font-size:0.82em">${s.observaciones || '<span style="color:#bbb">—</span>'}</td>
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
    .header h2 { font-size: 13px; font-weight: 800; color: rgb(39,20,71); letter-spacing: 0.5px; margin-bottom: 2px; }
    .header h3 { font-size: 11px; font-weight: 700; color: rgb(114,0,53); margin-bottom: 4px; }
    .header p  { font-size: 10px; color: #555; }
    .resumen { display: flex; gap: 18px; justify-content: center; margin-bottom: 14px; flex-wrap: wrap; }
    .resumen-item { background: #f9f0f4; border: 1px solid #e8c8d8; border-radius: 8px; padding: 6px 16px; text-align: center; }
    .resumen-item .val { font-size: 16px; font-weight: 800; color: rgb(114,0,53); display:block; }
    .resumen-item .lbl { font-size: 9px; color: #888; font-weight: 600; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
    thead { background: linear-gradient(90deg, rgb(39,20,71), rgb(114,0,53)); }
    th { color: #fff; padding: 8px 7px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; text-align: center; border-right: 1px solid rgba(255,255,255,0.15); }
    th:last-child { border-right: none; }
    td { padding: 7px 7px; border-bottom: 1px solid #f0e6ec; vertical-align: middle; }
    tr:nth-child(even) td { background: #fdf6fa; }
    .footer { margin-top: 24px; border-top: 2px solid rgb(114,0,53); padding-top: 14px; }
    .footer-row { display: flex; justify-content: space-between; align-items: flex-end; }
    .firma-block { text-align: center; }
    .firma-line { border-top: 1.5px solid #555; width: 180px; margin: 36px auto 4px; }
    .firma-label { font-size: 9px; color: #555; font-weight: 700; text-transform: uppercase; }
    .nota { font-size: 9px; color: #888; font-style: italic; text-align: center; margin-top: 10px; }
</style>
</head>
<body>
<div class="header">
    <h2>SERVICIO DEPARTAMENTAL DE SALUD</h2>
    <h3>RECURSOS HUMANOS</h3>
    <p>Trinidad, ${fechaHoy}</p>
    <p style="font-weight:700;font-size:12px;color:rgb(39,20,71);margin-top:6px">HISTORIAL DE SOLICITUDES DE VACACIONES</p>
    <p style="font-size:10px;color:rgb(114,0,53);font-weight:600">${USUARIO_ACTUAL.nombre} &nbsp;·&nbsp; C.I. ${USUARIO_ACTUAL.ci}</p>
</div>
<div class="resumen">
    <div class="resumen-item">
        <span class="val">${total}</span>
        <span class="lbl">Total Solicitudes</span>
    </div>
    <div class="resumen-item">
        <span class="val" style="color:#1e8449">${dias_usados}</span>
        <span class="lbl">Días Usados</span>
    </div>
    <div class="resumen-item">
        <span class="val" style="color:#d68910">${dias_pendientes}</span>
        <span class="lbl">Días Pendientes</span>
    </div>
    <div class="resumen-item">
        <span class="val" style="color:rgb(39,20,71)">${resumenGlobal.dias_adeudados}</span>
        <span class="lbl">Saldo Disponible</span>
    </div>
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
            <th>Nivel 1<br><span style="font-weight:400;font-size:0.85em">Jefe de Área</span></th>
            <th>Nivel 2<br><span style="font-weight:400;font-size:0.85em">Gte. Adm./Salud</span></th>
            <th>Nivel 3<br><span style="font-weight:400;font-size:0.85em">Gerente General</span></th>
            <th>Observaciones</th>
        </tr>
    </thead>
    <tbody>${filas}</tbody>
</table>
<div class="footer">
    <div class="footer-row">
        <div></div>
        <div class="firma-block">
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
