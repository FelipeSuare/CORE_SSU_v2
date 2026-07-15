// ══════════════════════════════════════════════════════════════
//  CONFIGURACIÓN Y CONSTANTES
// ══════════════════════════════════════════════════════════════
const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]').content;

const URL_DATOS       = '/api/vacaciones/datos/';
const URL_RETORNO     = '/api/vacaciones/calcular-retorno/';
const URL_CREAR       = '/api/vacaciones/crear/';
const URL_SEGUIMIENTO = '/api/vacaciones/seguimiento/';

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ══════════════════════════════════════════════════════════════
//  ELEMENTOS DEL DOM  (se inicializan dentro de DOMContentLoaded)
// ══════════════════════════════════════════════════════════════
let tipoContratoInput, funcionarioInput, fechaIngresoInput, fechaSolicitudInput;
let fechaSalidaInput, diasTomarInput, fechaRetornoInput, motivoVacacionTextarea;
let saldosContainer, notificationMessage, vacationRequestForm;
let summaryModal, cancelModalBtn, confirmModalBtn;
let btnTracking, trackingPanel, closeTracking, trackingContent;

// ══════════════════════════════════════════════════════════════
//  ESTADO DEL MÓDULO
// ══════════════════════════════════════════════════════════════
let datosFormulario  = null;
let retornoData      = null;
let calcularTimeout  = null;

// ══════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    // Inicializar referencias DOM aquí, garantizando que el HTML ya está cargado
    tipoContratoInput    = document.getElementById('tipoContrato');
    funcionarioInput     = document.getElementById('funcionario');
    fechaIngresoInput    = document.getElementById('fechaIngreso');
    fechaSolicitudInput  = document.getElementById('fechaSolicitud');
    fechaSalidaInput     = document.getElementById('fechaSalida');
    diasTomarInput       = document.getElementById('diasTomar');
    fechaRetornoInput    = document.getElementById('fechaRetorno');
    motivoVacacionTextarea = document.getElementById('motivoVacacion');
    saldosContainer      = document.getElementById('saldosContainer');
    notificationMessage  = document.getElementById('notificationMessage');
    vacationRequestForm  = document.getElementById('vacationRequestForm');
    summaryModal         = document.getElementById('summaryModal');
    cancelModalBtn       = document.getElementById('cancelModalBtn');
    confirmModalBtn      = document.getElementById('confirmModalBtn');
    btnTracking          = document.getElementById('btnTracking');
    trackingPanel        = document.getElementById('trackingPanel');
    closeTracking        = document.getElementById('closeTracking');
    trackingContent      = document.getElementById('trackingContent');

    // Registrar listeners que dependen del DOM
    fechaSalidaInput.addEventListener('change', triggerCalculo);
    diasTomarInput.addEventListener('input',  triggerCalculo);

    vacationRequestForm.addEventListener('submit', manejarEnvioFormulario);
    cancelModalBtn.addEventListener('click', ocultarModal);
    summaryModal.addEventListener('click', e => { if (e.target === summaryModal) ocultarModal(); });
    confirmModalBtn.addEventListener('click', enviarSolicitud);

    btnTracking.addEventListener('click', () => {
        trackingPanel.classList.toggle('show');
        if (trackingPanel.classList.contains('show')) {
            document.getElementById('profilePanel')?.classList.remove('show');
            cargarSeguimiento();
        }
    });
    closeTracking.addEventListener('click', () => trackingPanel.classList.remove('show'));

    document.getElementById('btnProfile')?.addEventListener('click', e => {
        e.stopPropagation();
        document.getElementById('profilePanel')?.classList.toggle('show');
        trackingPanel.classList.remove('show');
    });

    document.addEventListener('click', e => {
        if (!document.querySelector('.tracking-button-container')?.contains(e.target))
            trackingPanel.classList.remove('show');
        if (!document.querySelector('.profile-switcher-container')?.contains(e.target))
            document.getElementById('profilePanel')?.classList.remove('show');
    });

    fechaSolicitudInput.value = new Date().toISOString().split('T')[0];
    await cargarDatosFormulario();
});

// ══════════════════════════════════════════════════════════════
//  CARGA DE DATOS DEL FUNCIONARIO AUTENTICADO
// ══════════════════════════════════════════════════════════════
async function cargarDatosFormulario() {
    try {
        const resp = await fetch(URL_DATOS, { headers: { 'X-CSRFToken': CSRF_TOKEN } });
        const data = await resp.json();

        if (data.error) {
            AppDialog.alert(data.error);
            return;
        }

        datosFormulario = data;

        if (data.sin_jefe_area) {
            const alerta = document.getElementById('alertaSinJefeArea');
            if (alerta) alerta.style.display = 'flex';
        }

        // Renderizar roles reales desde BD en el profile-switcher
        renderizarRoles(data.roles || ['Funcionario'], data.nombre_completo);

        // Prellenar campos de solo lectura
        tipoContratoInput.value  = data.tipo_contrato || '—';
        funcionarioInput.value   = data.nombre_completo;
        fechaIngresoInput.value  = data.fecha_ingreso;
        fechaSolicitudInput.value = data.fecha_solicitud;
        document.getElementById('requestIdDisplay').textContent = data.siguiente_codigo;

        // Fecha mínima de salida: la mayor entre fecha_ingreso y fecha_solicitud (hoy)
        const minSalida = data.fecha_ingreso > data.fecha_solicitud
            ? data.fecha_ingreso
            : data.fecha_solicitud;
        fechaSalidaInput.min = minSalida;

        // Renderizar saldos
        renderizarSaldos(data.saldos, data.gestiones_con_saldo);

        // Notificación de gestiones acumuladas
        const n = data.gestiones_con_saldo;
        if (n >= 2) {
            mostrarNotificacion(
                `¡URGENTE! Tiene ${n} gestiones acumuladas sin tomar. La normativa no permite acumular más de 2 gestiones.`,
                'urgente'
            );
        } else if (n >= 1) {
            mostrarNotificacion(
                `Tiene ${n} gestiones acumuladas. Se recomienda coordinar sus vacaciones pendientes.`,
                'advertencia'
            );
        } else {
            mostrarNotificacion('No hay alertas de vacaciones acumuladas.', 'normal');
        }

        if (!data.puede_solicitar) {
            const msg = data.saldos.dias_adeudados <= 0
                ? 'No tiene días de vacación disponibles.'
                : 'Aún no cumple 1 año de antigüedad para solicitar vacaciones.';
            AppDialog.alert(msg);
            vacationRequestForm.querySelector('button[type="submit"]').disabled = true;
        }

        // Cargar seguimiento al inicializar
        await cargarSeguimiento();

    } catch (err) {
        console.error('Error al cargar datos del formulario:', err);
        AppDialog.alert('No se pudieron cargar los datos del formulario. Verifique su conexión.');
    }
}

// ══════════════════════════════════════════════════════════════
//  RENDERIZADO DE SALDOS
// ══════════════════════════════════════════════════════════════
let gestionesExpandidas = false;

function renderizarSaldos(saldos, gestionesConSaldo) {
    const { gestiones, dias_negados, dias_adeudados } = saldos;

    if (!gestiones || gestiones.length === 0) {
        saldosContainer.innerHTML = `
            <div class="saldo-card">
                <div class="saldo-label">SIN GESTIONES</div>
                <div class="saldo-value">0 <span>días</span></div>
            </div>`;
        return;
    }

    let html = '';
    gestiones.forEach((g, i) => {
        const oculta = i >= 2 ? 'saldo-card-extra' : '';
        html += `
        <div class="saldo-card ${oculta}" style="${i >= 2 ? 'display:none' : ''}">
            <div class="saldo-label">${g.label}</div>
            <div class="saldo-value">${g.dias} <span>días</span></div>
        </div>`;
    });

    if (dias_negados > 0) {
        html += `
        <div class="saldo-card saldo-card-negados">
            <div class="saldo-label">DÍAS NEGADOS <i class="material-symbols-outlined" title="Registro histórico informativo de los días que la institución no permitió tomar. No vencen nunca. Ya fueron repuestos en la gestión más antigua por lo que no se suman al total adeudado." style="font-size:14px;cursor:help;vertical-align:middle">info</i></div>
            <div class="saldo-value">${dias_negados} <span>días</span></div>
        </div>`;
    }

    html += `
    <div class="saldo-card saldo-card-total">
        <div class="saldo-label">TOTAL ADEUDADO <i class="material-symbols-outlined" title="Calculado automáticamente por la BD sumando únicamente las gestiones activas (máx. 2). No incluye días negados para evitar doble conteo." style="font-size:14px;cursor:help;vertical-align:middle">info</i></div>
        <div class="saldo-value">${dias_adeudados} <span>días</span></div>
    </div>`;

    if (gestiones.length > 2) {
        html += `
        <button type="button" class="btn-ver-mas" id="btnVerMas" onclick="toggleGestiones()">
            <i class="material-symbols-outlined" id="iconVerMas">expand_more</i> Ver gestiones anteriores
        </button>`;
    }

    saldosContainer.innerHTML = html;
    gestionesExpandidas = false;
}

function toggleGestiones() {
    gestionesExpandidas = !gestionesExpandidas;
    document.querySelectorAll('.saldo-card-extra').forEach(el => {
        el.style.display = gestionesExpandidas ? 'block' : 'none';
    });
    const btn = document.getElementById('btnVerMas');
    if (btn) {
        btn.innerHTML = gestionesExpandidas
            ? '<i class="material-symbols-outlined" id="iconVerMas">expand_less</i> Ver menos'
            : '<i class="material-symbols-outlined" id="iconVerMas">expand_more</i> Ver gestiones anteriores';
    }
}

function mostrarNotificacion(texto, tipo = 'normal') {
    const estilos = {
        urgente:     { bg: 'linear-gradient(135deg, rgba(255,200,200,0.6), rgba(255,255,255,0.9))', borde: '4px solid #D32F2F' },
        advertencia: { bg: 'linear-gradient(135deg, rgba(255,230,200,0.6), rgba(255,255,255,0.9))', borde: '4px solid #E65100' },
        normal:      { bg: 'linear-gradient(135deg, rgba(249,201,201,0.5), rgba(255,255,255,0.9))', borde: '4px solid rgb(114,0,53)' },
    };
    const s = estilos[tipo] || estilos.normal;
    notificationMessage.textContent = texto;
    notificationMessage.style.background   = s.bg;
    notificationMessage.style.borderLeft   = s.borde;
}

// ══════════════════════════════════════════════════════════════
//  CÁLCULO DE FECHA DE RETORNO (con debounce)
// ══════════════════════════════════════════════════════════════
function triggerCalculo() {
    clearTimeout(calcularTimeout);
    calcularTimeout = setTimeout(calcularFechaRetorno, 400);
}

async function calcularFechaRetorno() {
    const fechaSalida = fechaSalidaInput.value;
    const diasTomar   = diasTomarInput.value;

    if (!fechaSalida || !diasTomar || parseFloat(diasTomar) <= 0) {
        fechaRetornoInput.value = '';
        retornoData = null;
        return;
    }

    try {
        const resp = await fetch(URL_RETORNO, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': CSRF_TOKEN,
            },
            body: JSON.stringify({
                fecha_salida: fechaSalida,
                dias_solicitados: diasTomar,
                cod_funcionario: datosFormulario?.cod_funcionario || '',
            }),
        });

        const data = await resp.json();
        if (data.error) {
            fechaRetornoInput.value = '';
            return;
        }

        retornoData = data;
        fechaRetornoInput.value = data.fecha_retorno;

    } catch (err) {
        console.error('Error al calcular retorno:', err);
        // Fallback: cálculo local básico (sin feriados ni cumpleaños)
        calcularRetornoLocal(fechaSalida, parseInt(diasTomar));
    }
}

function calcularRetornoLocal(fechaSalida, diasTomar) {
    let fecha = new Date(fechaSalida + 'T00:00:00');
    let habiles = 0;
    while (habiles < diasTomar) {
        fecha.setDate(fecha.getDate() + 1);
        if (fecha.getDay() !== 0 && fecha.getDay() !== 6) habiles++;
    }
    fechaRetornoInput.value = fecha.toISOString().split('T')[0];
}

// ══════════════════════════════════════════════════════════════
//  VALIDACIÓN Y MODAL DE RESUMEN
// ══════════════════════════════════════════════════════════════
function manejarEnvioFormulario(e) {
    e.preventDefault();

    if (!datosFormulario) {
        AppDialog.alert('Los datos del formulario no están disponibles. Recargue la página.');
        return;
    }

    const motivo = motivoVacacionTextarea.value.trim();
    if (!motivo || motivo.length < 10) {
        AppDialog.alert('Ingrese un motivo válido para la vacación (mínimo 10 caracteres).');
        motivoVacacionTextarea.focus();
        return;
    }

    const fechaSalidaVal   = fechaSalidaInput.value;
    const fechaIngresoVal  = fechaIngresoInput.value;
    const fechaSolicitudVal = fechaSolicitudInput.value;

    if (!fechaSalidaVal) {
        AppDialog.alert('Seleccione la fecha de salida.');
        fechaSalidaInput.focus();
        return;
    }
    if (fechaSalidaVal < fechaIngresoVal) {
        AppDialog.alert('La fecha de salida no puede ser anterior a su fecha de ingreso a la institución.');
        fechaSalidaInput.focus();
        return;
    }
    if (fechaSalidaVal < fechaSolicitudVal) {
        AppDialog.alert('La fecha de salida no puede ser una fecha pasada.');
        fechaSalidaInput.focus();
        return;
    }

    const diasTomar  = parseFloat(diasTomarInput.value);
    const saldoTotal = datosFormulario.saldos.dias_adeudados;

    if (isNaN(diasTomar) || diasTomar <= 0) {
        AppDialog.alert('Ingrese una cantidad válida de días a tomar.');
        return;
    }

    if (diasTomar > saldoTotal) {
        AppDialog.alert(`No tiene suficiente saldo. Disponible: ${saldoTotal} días.`);
        return;
    }

    if (!fechaRetornoInput.value) {
        AppDialog.alert('Seleccione la fecha de salida e ingrese los días a tomar para calcular el retorno.');
        return;
    }

    poblarModal(diasTomar, saldoTotal, motivo);
    mostrarModal();
}

function poblarModal(diasTomar, saldoTotal, motivo) {
    const rd = retornoData || {};
    const efectivos = rd.dias_efectivos !== undefined ? rd.dias_efectivos : diasTomar;
    const saldoRestante = (saldoTotal - efectivos).toFixed(1);

    document.getElementById('summaryDiasNoHabiles').textContent =
        rd.dias_no_habiles !== undefined ? rd.dias_no_habiles : '—';
    document.getElementById('summaryDiasCumpleanos').textContent =
        rd.dias_cumpleanos !== undefined ? rd.dias_cumpleanos : '—';
    document.getElementById('summaryDiasEfectivos').textContent =
        rd.dias_efectivos !== undefined ? rd.dias_efectivos.toFixed(1) : diasTomar.toFixed(1);
    document.getElementById('summaryDiasFestivos').textContent =
        rd.dias_feriados !== undefined ? rd.dias_feriados : '—';

    if (rd.fecha_conclusion) {
        document.getElementById('summaryFechaConclusión').textContent =
            formatearFecha(rd.fecha_conclusion);
    } else {
        // Fallback: día anterior a fecha_retorno
        const retorno = fechaRetornoInput.value;
        if (retorno) {
            const d = new Date(retorno + 'T00:00:00');
            d.setDate(d.getDate() - 1);
            document.getElementById('summaryFechaConclusión').textContent = formatearFecha(d);
        } else {
            document.getElementById('summaryFechaConclusión').textContent = '--/--/----';
        }
    }

    document.getElementById('summarySaldoDias').textContent = `${saldoRestante} días`;
    document.getElementById('summaryMotivo').textContent = motivo;
}

// ══════════════════════════════════════════════════════════════
//  ENVÍO DE SOLICITUD
// ══════════════════════════════════════════════════════════════
async function enviarSolicitud() {
    confirmModalBtn.disabled = true;

    try {
        const resp = await fetch(URL_CREAR, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': CSRF_TOKEN,
            },
            body: JSON.stringify({
                fecha_salida:      fechaSalidaInput.value,
                fecha_retorno:     fechaRetornoInput.value,
                dias_solicitados:  (retornoData?.dias_efectivos ?? parseFloat(diasTomarInput.value)),
                motivo_vacacion:   motivoVacacionTextarea.value.trim(),
            }),
        });

        // Leer como texto primero para manejar respuestas no-JSON
        const text = await resp.text();
        let data = {};
        try {
            data = JSON.parse(text);
        } catch {
            // El servidor devolvió HTML (error 500 u otro)
            console.error('Respuesta no-JSON del servidor:', text.substring(0, 300));
            ocultarModal();
            AppDialog.alert(
                `Error del servidor (${resp.status}). Verifique que el sistema esté funcionando correctamente.`,
                { title: 'Error', icon: 'error' }
            );
            return;
        }

        ocultarModal();

        if (!resp.ok || data.error) {
            AppDialog.alert(data.error || `Error al enviar la solicitud (${resp.status}).`,
                { title: 'Error', icon: 'error' });
            return;
        }

        AppDialog.alert(
            `Solicitud ${data.codigo} registrada exitosamente. Será notificado cuando avance el proceso de aprobación.`,
            { title: 'Solicitud registrada', icon: 'check_circle', variant: 'success' }
        );

        setTimeout(() => location.reload(), 1800);

    } catch (err) {
        console.error('Error de red al crear solicitud:', err);
        ocultarModal();
        AppDialog.alert(
            'No se pudo conectar con el servidor. Verifique su conexión e intente nuevamente.',
            { title: 'Error de conexión', icon: 'wifi_off' }
        );
    } finally {
        confirmModalBtn.disabled = false;
    }
}

// ══════════════════════════════════════════════════════════════
//  SEGUIMIENTO DE SOLICITUD
// ══════════════════════════════════════════════════════════════
async function cargarSeguimiento() {
    trackingContent.innerHTML = `
        <div class="no-request-message">
            <i class="material-symbols-outlined">hourglass_top</i>
            <p>Cargando seguimiento…</p>
        </div>`;

    try {
        const resp = await fetch(URL_SEGUIMIENTO, { headers: { 'X-CSRFToken': CSRF_TOKEN } });
        const data = await resp.json();

        if (!data.tiene_solicitud) {
            trackingContent.innerHTML = `
                <div class="no-request-message">
                    <i class="material-symbols-outlined">beach_access</i>
                    <p>No tiene solicitudes de vacación registradas.</p>
                </div>`;
            return;
        }

        let html = `<p style="font-size:0.82em;color:#720035;font-weight:700;margin-bottom:8px">
                        ${esc(data.codigo)} — <span style="font-weight:500">${esc(data.estado)}</span>
                    </p>
                    <ul class="timeline">`;

        data.timeline.forEach(paso => {
            const iconMap    = { approved: 'check', rejected: 'close', pending: 'autorenew', sent: 'check', inactive: 'more_horiz', na: 'person_off' };
            const statusText = { approved: 'APROBADO', rejected: 'RECHAZADO', pending: 'PENDIENTE', sent: 'ENVIADO', inactive: 'Esperando', na: 'NO ASIGNADO' };

            const icon   = iconMap[paso.estado] || 'more_horiz';
            const text   = statusText[paso.estado] || paso.estado.toUpperCase();
            const coment = paso.comentarios
                ? `<p class="timeline-comments">${esc(paso.comentarios)}</p>`
                : '';

            html += `
            <li class="timeline-item">
                <div class="timeline-icon ${paso.estado}">
                    <i class="material-symbols-outlined">${icon}</i>
                </div>
                <div class="timeline-content ${paso.estado}">
                    <p class="timeline-role">${esc(paso.nivel)}</p>
                    <p class="timeline-name">${esc(paso.responsable)}</p>
                    <span class="timeline-status ${paso.estado}">${text}</span>
                    <p class="timeline-date">${paso.fecha ? formatearFecha(paso.fecha) : '--/--/----'}</p>
                    ${coment}
                </div>
            </li>`;
        });

        html += '</ul>';
        trackingContent.innerHTML = html;

    } catch (err) {
        console.error('Error al cargar seguimiento:', err);
        trackingContent.innerHTML = `
            <div class="no-request-message">
                <i class="material-symbols-outlined">error</i>
                <p>Error al cargar el seguimiento.</p>
            </div>`;
    }
}

// ══════════════════════════════════════════════════════════════
//  CAMBIO DE PERFIL — delega al componente compartido
// ══════════════════════════════════════════════════════════════

function renderizarRoles(roles, nombreCompleto) {
    window.initProfileSwitcher?.({ roles, nombre: nombreCompleto });
}

// ══════════════════════════════════════════════════════════════
//  MODAL — abrir / cerrar
// ══════════════════════════════════════════════════════════════
function mostrarModal() {
    summaryModal.classList.add('active');
    setTimeout(() => document.querySelector('.form-modal').classList.add('active'), 10);
}

function ocultarModal() {
    document.querySelector('.form-modal').classList.remove('active');
    setTimeout(() => summaryModal.classList.remove('active'), 300);
}

// ══════════════════════════════════════════════════════════════
//  FORMATO DE FECHA
// ══════════════════════════════════════════════════════════════
function formatearFecha(fecha) {
    if (!fecha) return '--/--/----';
    let d;
    if (typeof fecha === 'string') {
        d = new Date(fecha + 'T00:00:00');
    } else if (fecha instanceof Date) {
        d = fecha;
    } else {
        return '--/--/----';
    }
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    return `${dd}/${mm}/${yy}`;
}
