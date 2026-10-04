// ── Sidebar elements ─────────────────────────────────────────────
const sidebar       = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const mainContent   = document.getElementById('mainContent');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');

// Overlay (created once, always in DOM)
const overlay = document.createElement('div');
overlay.className = 'sidebar-overlay';
document.body.appendChild(overlay);

// ── Helpers ──────────────────────────────────────────────────────
function isMobile() {
    return window.innerWidth <= 768;
}

function openMobile() {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('active');
    if (mobileMenuBtn) {
        mobileMenuBtn.querySelector('.material-symbols-outlined').textContent = 'close';
    }
}

function closeMobile() {
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('active');
    if (mobileMenuBtn) {
        mobileMenuBtn.querySelector('.material-symbols-outlined').textContent = 'menu';
    }
}

// ── Sidebar toggle ───────────────────────────────────────────────
// Desktop: colapsa/expande. Móvil: solo cierra (el botón está dentro del sidebar visible).
sidebarToggle.addEventListener('click', () => {
    if (isMobile()) {
        closeMobile();
    } else {
        sidebar.classList.toggle('collapsed');
        mainContent.classList.toggle('expanded');
    }
});

// Botón hamburguesa del topbar móvil
if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.contains('mobile-open') ? closeMobile() : openMobile();
    });
}

// Click en overlay cierra el sidebar
overlay.addEventListener('click', closeMobile);

// ── Ítems del menú ───────────────────────────────────────────────
const menuItems = document.querySelectorAll('.menu-item a');
menuItems.forEach(item => {
    item.addEventListener('click', () => {
        if (!item.classList.contains('submenu-toggle')) {
            document.querySelectorAll('.menu-item').forEach(mi => mi.classList.remove('active'));
            item.closest('.menu-item').classList.add('active');
            if (isMobile()) closeMobile();
        }
    });
});

// ── Submenús ─────────────────────────────────────────────────────
const submenuToggles = document.querySelectorAll('.submenu-toggle');
submenuToggles.forEach(toggle => {
    toggle.addEventListener('click', (e) => {
        e.preventDefault();
        toggle.closest('.has-submenu').classList.toggle('open');
    });
});

const submenuItems = document.querySelectorAll('.submenu a');
submenuItems.forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.menu-item').forEach(mi => mi.classList.remove('active'));
        item.closest('.has-submenu').classList.add('active');
        if (isMobile()) closeMobile();
    });
});

// ── Cerrar sesión ─────────────────────────────────────────────────
const btnLogout = document.querySelector('.btn-logout');
btnLogout.addEventListener('click', async () => {
    const confirmar = await AppDialog.confirm('¿Estás seguro que deseas cerrar sesión?', {
        title: 'Confirmar cierre de sesion',
        icon: 'logout',
        confirmText: 'Cerrar sesion',
        cancelText: 'Cancelar',
        variant: 'danger'
    });

    if (confirmar) {
        await AppDialog.alert('Sesion cerrada correctamente', {
            title: 'Sesion finalizada',
            icon: 'check_circle',
            variant: 'success'
        });
        window.location.href = '/loging.html';
    }
});

// ── Resize ────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
    if (!isMobile()) {
        closeMobile();
    }
    updateCarousel();
});

// ── CAROUSEL ──────────────────────────────────────────────────────
const carouselTrack = document.getElementById('carouselTrack');
const slides        = document.querySelectorAll('.carousel-slide');
const prevBtn       = document.getElementById('prevBtn');
const nextBtn       = document.getElementById('nextBtn');
const indicators    = document.querySelectorAll('.indicator');

let currentSlide = 0;
const totalSlides = slides.length;

function updateCarousel() {
    const slideWidth = slides[0].clientWidth;
    carouselTrack.style.transform = `translateX(-${currentSlide * slideWidth}px)`;

    indicators.forEach((indicator, index) => {
        indicator.classList.toggle('active', index === currentSlide);
    });

    slides.forEach((slide, index) => {
        slide.classList.toggle('active', index === currentSlide);
    });
}

nextBtn.addEventListener('click', () => {
    currentSlide = (currentSlide + 1) % totalSlides;
    updateCarousel();
});

prevBtn.addEventListener('click', () => {
    currentSlide = (currentSlide - 1 + totalSlides) % totalSlides;
    updateCarousel();
});

indicators.forEach((indicator, index) => {
    indicator.addEventListener('click', () => {
        currentSlide = index;
        updateCarousel();
    });
});

let autoplayInterval = setInterval(() => {
    currentSlide = (currentSlide + 1) % totalSlides;
    updateCarousel();
}, 5000);

const carouselWrapper = document.querySelector('.carousel-wrapper');
carouselWrapper.addEventListener('mouseenter', () => clearInterval(autoplayInterval));
carouselWrapper.addEventListener('mouseleave', () => {
    autoplayInterval = setInterval(() => {
        currentSlide = (currentSlide + 1) % totalSlides;
        updateCarousel();
    }, 5000);
});

// ── Alertas de vacaciones para RRHH / Administrador ──
// (1) Gestiones a punto de perder días  (2) Hoy toca poblar
function _esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _csrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content ?? '';
}

async function verificarAlertasVacaciones() {
    try {
        // Notificación "Hoy toca poblar vacaciones" desactivada a pedido del usuario (2026-07-03).
        // El endpoint, mostrarAlertaPoblarHoy() y el fetch siguen intactos; para reactivar,
        // descomentar el fetch de abajo y las dos líneas marcadas.
        const [resRiesgo /*, resPoblar */] = await Promise.all([
            fetch('/api/vacaciones/alerta-gestiones-riesgo/'),
            // fetch('/api/vacaciones/alerta-poblar-hoy/'),
        ]);

        // 403 = no es RRHH/Admin, ignorar silenciosamente
        const riesgo = resRiesgo.ok ? (await resRiesgo.json()).funcionarios || [] : [];
        // const poblar = resPoblar.ok ? (await resPoblar.json()).funcionarios || [] : [];

        if (riesgo.length) mostrarAlertaRiesgo(riesgo);
        // if (poblar.length) mostrarAlertaPoblarHoy(poblar);
    } catch (_) {}
}

function mostrarAlertaRiesgo(funcionarios) {
    const filas = funcionarios.map(f => `
        <tr data-cod="${_esc(f.cod)}">
            <td>${_esc(f.nombre)}</td>
            <td>${_esc(String(f.ci))}</td>
            <td>${_esc(f.unidad)}</td>
            <td>${_esc(String(f.anio_en_riesgo))}</td>
            <td><span class="alerta-dias">${f.dias} días</span></td>
            <td><span class="alerta-fecha-limite">${_esc(f.fecha_limite)}</span></td>
        </tr>`);

    crearWidgetAlerta({
        id:            'alertaGestionesRiesgo',
        titulo:        'A punto de perder días de vacación',
        subtitulo:     'Ya tienen sus 2 gestiones acumuladas y una nueva por acreditar dentro del próximo mes: al acreditarla, la gestión más antigua se pierde en la fecha límite indicada. Pídales solicitar vacaciones antes de esa fecha.',
        headers:       ['Funcionario', 'C.I.', 'Unidad', 'Gestión en Riesgo', 'Días en Riesgo', 'Fecha Límite'],
        filas,
        contadorLabel: ' funcionarios a punto de perder días de vacación',
    });
}

function mostrarAlertaPoblarHoy(funcionarios) {
    const filas = funcionarios.map(f => `
        <tr data-cod="${_esc(f.cod)}">
            <td>${_esc(f.nombre)}</td>
            <td>${_esc(String(f.ci))}</td>
            <td>${_esc(f.unidad)}</td>
            <td>${_esc(String(f.anio_pendiente))}</td>
            <td>${_esc(f.aniversario)}</td>
            <td><button class="alerta-accion-btn" data-cod="${_esc(f.cod)}">Poblar ahora</button></td>
        </tr>`);

    crearWidgetAlerta({
        id:            'alertaPoblarHoy',
        titulo:        'Hoy toca poblar vacaciones',
        subtitulo:     'Ya cumplieron (o correspondía el día hábil anterior, si cayó en fin de semana/feriado) su aniversario de ingreso y todavía no se les acreditó la gestión.',
        headers:       ['Funcionario', 'C.I.', 'Unidad', 'Gestión', 'Correspondía', ''],
        filas,
        contadorLabel: ' funcionarios: hoy toca poblar vacaciones',
    });
}

// ── Widget genérico (usado por ambas alertas) ──
// Todos los widgets viven en una única pila fija; el espaciado lo da el
// `gap` del contenedor, no un `top` calculado a mano por widget.
function _stackAlertas() {
    let stack = document.getElementById('alertaStack');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'alertaStack';
        stack.className = 'alerta-stack';
        document.body.appendChild(stack);
    }
    return stack;
}

function crearWidgetAlerta({ id, titulo, subtitulo, headers, filas, contadorLabel, contador = filas.length }) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();

    const flotante = document.createElement('div');
    flotante.id        = id;
    flotante.className = 'alerta-flotante';

    flotante.innerHTML = `
        <div class="alerta-trigger" id="${id}Trigger">
            <i class="material-symbols-outlined alerta-trigger-icon">notification_important</i>
            <span class="alerta-count">${contador}</span>
            <span class="alerta-trigger-text">${contadorLabel}</span>
            <button class="alerta-close-btn" id="${id}Close" title="Cerrar notificación">
                <i class="material-symbols-outlined">close</i>
            </button>
        </div>
        <div class="alerta-panel">
            <div class="alerta-panel-header">
                <p class="alerta-panel-title">${titulo}</p>
                <p class="alerta-panel-sub">${subtitulo}</p>
            </div>
            <div class="alerta-panel-body">
                <table class="alerta-table">
                    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                    <tbody>${filas.join('')}</tbody>
                </table>
            </div>
        </div>`;

    _stackAlertas().appendChild(flotante);

    document.getElementById(`${id}Trigger`).addEventListener('click', e => {
        if (e.target.closest(`#${id}Close`)) return;
        flotante.classList.toggle('open');
    });

    document.getElementById(`${id}Close`).addEventListener('click', e => {
        e.stopPropagation();
        cerrarWidgetAlerta(id);
    });

    flotante.querySelectorAll('.alerta-accion-btn').forEach(btn => {
        btn.addEventListener('click', () => poblarFuncionarioDesdeAlerta(btn));
    });

    return flotante;
}

async function poblarFuncionarioDesdeAlerta(btn) {
    const cod = btn.dataset.cod;
    btn.disabled    = true;
    btn.textContent = 'Poblando…';

    try {
        const res  = await fetch('/api/vacaciones/inicializar/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': _csrfToken() },
            body: JSON.stringify({ cod_funcionario: cod }),
        });
        const data = await res.json();

        if (!res.ok || data.error) {
            btn.disabled    = false;
            btn.textContent = 'Reintentar';
            return;
        }

        // Quita las filas de ese funcionario en cualquier widget donde aparezca
        document.querySelectorAll(`.alerta-flotante tr[data-cod="${CSS.escape(cod)}"]`)
            .forEach(tr => tr.remove());

        document.querySelectorAll('.alerta-flotante').forEach(actualizarContadorWidget);
    } catch (_) {
        btn.disabled    = false;
        btn.textContent = 'Reintentar';
    }
}

function actualizarContadorWidget(flotante) {
    const filasRestantes = flotante.querySelectorAll('.alerta-table tbody tr').length;
    if (filasRestantes === 0) {
        cerrarWidgetAlerta(flotante.id);
        return;
    }
    flotante.querySelector('.alerta-count').textContent = filasRestantes;
}

function cerrarWidgetAlerta(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
    el.style.opacity    = '0';
    el.style.transform  = 'scale(0.92)';
    setTimeout(() => el.remove(), 230);
}

document.addEventListener('DOMContentLoaded', verificarAlertasVacaciones);

// ── Notificación a RRHH: solicitudes rechazadas recientemente (en rojo) ──
// Muestra las rechazadas en los últimos 30 días que aún no se descartaron;
// al cerrarla se recuerda la última vista en localStorage.
const _KEY_RECHAZADAS_VISTAS = 'vacRechazadasVistaHasta';
const _DIAS_NOTIF_RECHAZADAS = 30;

async function verificarSolicitudesRechazadas() {
    try {
        const res = await fetch('/api/vacaciones/rechazadas/');
        if (!res.ok) return; // 403 = no es RRHH/Admin
        const desde = new Date(Date.now() - _DIAS_NOTIF_RECHAZADAS * 864e5).toLocaleDateString('en-CA');
        let vistaHasta = 0;
        try { vistaHasta = Number(localStorage.getItem(_KEY_RECHAZADAS_VISTAS)) || 0; } catch (_) {}

        const rechazadas = ((await res.json()).solicitudes || [])
            .filter(s => s.id > vistaHasta && (s.fecha_rechazo || s.fecha_solicitud) >= desde);
        if (rechazadas.length) mostrarAlertaRechazadas(rechazadas);
    } catch (_) {}
}

function mostrarAlertaRechazadas(solicitudes) {
    const fmtFecha = f => (f ? f.split('-').reverse().join('/') : '—');
    const filas = solicitudes.map(s => `
        <tr>
            <td>${_esc(s.codigo)}</td>
            <td>${_esc(s.funcionario)}</td>
            <td>${fmtFecha(s.fecha_rechazo)}</td>
            <td>${_esc(s.aprobador_rechazo)}</td>
            <td>${_esc(s.observacion)}</td>
        </tr>`);

    const flotante = crearWidgetAlerta({
        id:            'alertaSolicitudesRechazadas',
        titulo:        'Solicitudes de vacación rechazadas',
        subtitulo:     `Rechazadas en los últimos ${_DIAS_NOTIF_RECHAZADAS} días.`,
        headers:       ['Solicitud', 'Funcionario', 'Fecha Rechazo', 'Rechazada por', 'Motivo'],
        filas,
        contadorLabel: solicitudes.length === 1 ? ' solicitud rechazada' : ' solicitudes rechazadas',
    });
    flotante.classList.add('rechazada');
    flotante.querySelector('.alerta-panel').insertAdjacentHTML('beforeend', `
        <div class="alerta-panel-footer">
            <a class="alerta-accion-btn" href="SolicitudesRechazadas.html">Ver solicitudes rechazadas</a>
        </div>`);

    document.getElementById('alertaSolicitudesRechazadasClose').addEventListener('click', () => {
        const maxId = Math.max(...solicitudes.map(s => s.id));
        try { localStorage.setItem(_KEY_RECHAZADAS_VISTAS, String(maxId)); } catch (_) {}
    });
}

document.addEventListener('DOMContentLoaded', verificarSolicitudesRechazadas);

// ── Alertas para Jefe de Area / Gerentes (aprobadores): su gente a cargo ──
// (1) Solicitudes de vacación pendientes de su aprobación
// (2) Gestiones vencidas/por vencer de sus subordinados
async function verificarAlertasJefeArea() {
    try {
        const [resPendientes, resGestiones] = await Promise.all([
            fetch('/api/vacaciones/para-aprobar/'),
            fetch('/api/vacaciones/alerta-jefe-area/'),
        ]);

        // 403 / sin rol de aprobador = ignorar silenciosamente
        if (resPendientes.ok) {
            const data = await resPendientes.json();
            const pendientes = (data.solicitudes || []).filter(s => s.puede_actuar);
            if (pendientes.length) mostrarAlertaSolicitudesPendientes(pendientes);
        }

        if (resGestiones.ok) {
            const gestiones = (await resGestiones.json()).funcionarios || [];
            if (gestiones.length) mostrarAlertaGestionesEquipo(gestiones);
        }
    } catch (_) {}
}

const _urlRevisarSolicitud = id => `/Aprobacion.html?solicitud=${encodeURIComponent(id)}`;

function mostrarAlertaSolicitudesPendientes(solicitudes) {
    const filas = solicitudes.map(s => `
        <tr data-cod="${_esc(s.cod_funcionario)}" data-href="${_urlRevisarSolicitud(s.id)}" class="alerta-fila-link" title="Revisar solicitud">
            <td>${_esc(s.funcionario)}</td>
            <td>${_esc(s.cargo)}</td>
            <td>${_esc(s.fecha_solicitud)}</td>
            <td>${s.dias} días</td>
        </tr>`);

    const flotante = crearWidgetAlerta({
        id:            'alertaSolicitudesPendientes',
        titulo:        'Solicitudes de vacación pendientes de tu aprobación',
        subtitulo:     'Funcionarios a tu cargo con una solicitud de vacación esperando tu decisión. Haga clic en una para revisarla.',
        headers:       ['Funcionario', 'Cargo', 'Fecha Solicitud', 'Días'],
        filas,
        contadorLabel: solicitudes.length === 1 ? ' solicitud esperando tu aprobación' : ' solicitudes esperando tu aprobación',
    });

    flotante.querySelectorAll('tr[data-href]').forEach(tr =>
        tr.addEventListener('click', () => { window.location.href = tr.dataset.href; }));

    // Con una sola pendiente, el clic en la notificación lleva directo a ella.
    if (solicitudes.length === 1) {
        document.getElementById('alertaSolicitudesPendientesTrigger').addEventListener('click', e => {
            if (e.target.closest('.alerta-close-btn')) return;
            window.location.href = _urlRevisarSolicitud(solicitudes[0].id);
        });
    }
}

function mostrarAlertaGestionesEquipo(funcionarios) {
    const filas = funcionarios.map(f => `
        <tr data-cod="${_esc(f.cod)}">
            <td>${_esc(f.nombre)}</td>
            <td>${_esc(String(f.ci))}</td>
            <td>${_esc(String(f.anio_en_riesgo))}</td>
            <td><span class="alerta-dias">${f.dias} días</span></td>
            <td><span class="alerta-fecha-limite">${_esc(f.fecha_limite)}</span></td>
        </tr>`);

    crearWidgetAlerta({
        id:            'alertaGestionesEquipo',
        titulo:        'Tu equipo: a punto de perder días de vacación',
        subtitulo:     'Funcionarios a tu cargo que ya tienen sus 2 gestiones acumuladas y una nueva por acreditar: al acreditarla, la gestión más antigua se pierde en la fecha límite indicada.',
        headers:       ['Funcionario', 'C.I.', 'Gestión en Riesgo', 'Días en Riesgo', 'Fecha Límite'],
        filas,
        contadorLabel: ' de tu equipo a punto de perder días',
    });
}

document.addEventListener('DOMContentLoaded', verificarAlertasJefeArea);

// ── Notificación al funcionario: estado final de su última solicitud ──
// Reusa /seguimiento/ (misma fuente que el panel "Seguimiento" de Vacaciones.html):
// el panel muestra el motivo del rechazo/aprobación y enlaza al módulo.
// Solo estados finales (Aprobada / Rechazada). Al cerrarla queda marcada como
// vista en localStorage para esa solicitud+estado y no vuelve a aparecer.
const _ESTADOS_NOTIF_SOLICITUD = { Aprobada: 'approved', Rechazada: 'rejected' };

function _keyNotifSolicitud(data) {
    return `vacNotifVista:${data.id}:${data.estado}`;
}

async function verificarEstadoMiSolicitud() {
    try {
        const res = await fetch('/api/vacaciones/seguimiento/');
        if (!res.ok) return; // 403/404 = sin rol funcionario o sin ficha, ignorar
        const data = await res.json();
        if (!data.tiene_solicitud || !(data.estado in _ESTADOS_NOTIF_SOLICITUD)) return;
        if (localStorage.getItem(_keyNotifSolicitud(data))) return;
        mostrarAlertaEstadoSolicitud(data);
    } catch (_) {}
}

function mostrarAlertaEstadoSolicitud(data) {
    const rechazada  = data.estado === 'Rechazada';
    const pasoFinal  = data.timeline.filter(p => p.estado === _ESTADOS_NOTIF_SOLICITUD[data.estado]).pop();
    const statusText = { approved: 'APROBADO', rejected: 'RECHAZADO', pending: 'PENDIENTE', sent: 'ENVIADO', inactive: 'Esperando', na: 'NO ASIGNADO' };
    const fmtFecha   = f => (f ? f.split('-').reverse().join('/') : '--/--/----');

    const filas = data.timeline.map(p => `
        <tr>
            <td>${_esc(p.nivel)}</td>
            <td>${_esc(p.responsable)}</td>
            <td><span class="alerta-decision ${_esc(p.estado)}">${statusText[p.estado] || _esc(p.estado)}</span></td>
            <td>${fmtFecha(p.fecha)}</td>
            <td>${_esc(p.comentarios) || '—'}</td>
        </tr>`);

    const subtitulo = rechazada
        ? `Motivo del rechazo (${_esc(pasoFinal?.nivel)} — ${_esc(pasoFinal?.responsable)}): ${_esc(pasoFinal?.comentarios) || 'Sin observación registrada.'}`
        : 'Su solicitud fue aprobada en todos los niveles.';

    const flotante = crearWidgetAlerta({
        id:            'alertaEstadoSolicitud',
        titulo:        `Solicitud ${_esc(data.codigo)} — ${_esc(data.estado)}`,
        subtitulo,
        headers:       ['Nivel', 'Responsable', 'Decisión', 'Fecha', 'Observación'],
        filas,
        contador:      1,
        contadorLabel: ` solicitud ${_esc(data.codigo)}: ${_esc(data.estado.toUpperCase())}`,
    });

    flotante.classList.add(rechazada ? 'rechazada' : 'aprobada');
    flotante.querySelector('.alerta-panel').insertAdjacentHTML('beforeend', `
        <div class="alerta-panel-footer">
            <a class="alerta-accion-btn" href="Vacaciones.html#seguimiento">Ver seguimiento completo</a>
        </div>`);

    document.getElementById('alertaEstadoSolicitudClose').addEventListener('click', () => {
        try { localStorage.setItem(_keyNotifSolicitud(data), '1'); } catch (_) {}
    });
}

document.addEventListener('DOMContentLoaded', verificarEstadoMiSolicitud);
