// ======================================== ESTADO ========================================
let solicitudesVacaciones = [];
let solicitudesFiltradas  = [];
let solicitudSeleccionada = null;
let feriados              = new Set();   // ISO, para previsualizar días hábiles

// ======================================== ELEMENTOS DEL DOM ========================================
const funcionarioSearchInput = document.getElementById('funcionarioSearch');
const fechaDesdeInput        = document.getElementById('fechaDesde');
const fechaHastaInput        = document.getElementById('fechaHasta');
const btnBuscar              = document.getElementById('btnBuscar');
const btnLimpiarBusqueda     = document.getElementById('btnLimpiarBusqueda');
const solicitudesTableBody   = document.getElementById('solicitudesTableBody');

// Modal de Anulación
const modalAnulacion    = document.getElementById('modalAnulacion');
const btnCerrarModal    = document.getElementById('btnCerrarModal');
const btnCancelar       = document.getElementById('btnCancelar');

// Elementos del formulario del modal
const tipoAnulacionSelect   = document.getElementById('tipoAnulacion');
const fechasParcialGroup    = document.getElementById('fechasParcialGroup');
const nuevaFechaInicioInput = document.getElementById('nuevaFechaInicio');
const nuevaFechaFinalInput  = document.getElementById('nuevaFechaFinal');
const motivoAnulacionSelect = document.getElementById('motivoAnulacion');
const observacionesTextarea = document.getElementById('observaciones');
const btnConfirmarAnulacion = document.getElementById('btnConfirmarAnulacion');

// Elementos de información en el modal
const modalFuncionario  = document.getElementById('modalFuncionario');
const modalCargo        = document.getElementById('modalCargo');
const modalFechaInicio  = document.getElementById('modalFechaInicio');
const modalFechaFinal   = document.getElementById('modalFechaFinal');
const modalDiasTotales  = document.getElementById('modalDiasTotales');
const modalSaldoActual  = document.getElementById('modalSaldoActual');

// Elementos del resumen
const diasDevolverSpan = document.getElementById('diasDevolver');
const nuevoSaldoSpan   = document.getElementById('nuevoSaldo');

// Modal de Confirmación
const modalConfirmacion        = document.getElementById('modalConfirmacion');
const btnCancelarConfirmacion  = document.getElementById('btnCancelarConfirmacion');
const btnConfirmarFinal        = document.getElementById('btnConfirmarFinal');
const confirmDetalles          = document.getElementById('confirmDetalles');

// ======================================== FUNCIONES DE UTILIDAD ========================================

function formatearFecha(fechaISO) {
    const [año, mes, dia] = fechaISO.split('-');
    return `${dia}/${mes}/${año}`;
}

// Días hábiles en [desde, hasta) — mismo criterio que el backend.
function contarDiasHabiles(desdeISO, hastaISO) {
    let n = 0;
    for (let d = new Date(desdeISO + 'T00:00:00'); d < new Date(hastaISO + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
        const iso = d.toLocaleDateString('en-CA');
        if (d.getDay() !== 0 && d.getDay() !== 6 && !feriados.has(iso)) n++;
    }
    return n;
}

function obtenerBadgeEstado(estado) {
    const badges = {
        'activa':    '<span class="badge badge-activa">Activa</span>',
        'anulada':   '<span class="badge badge-anulada">Anulada</span>',
        'completada':'<span class="badge badge-completada">Completada</span>',
    };
    return badges[estado] || estado;
}

function _csrf() {
    return document.querySelector('meta[name="csrf-token"]')?.content ?? '';
}

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ======================================== FUNCIONES DE RENDERIZADO ========================================

function crearFilaTabla(solicitud) {
    const row = document.createElement('tr');

    const accionBtn = solicitud.estado === 'activa'
        ? `<button class="action-btn action-btn-edit" onclick="abrirModalAnulacion(${solicitud.id})">
               <i class="material-symbols-outlined">receipt_long_off</i> Anular
           </button>`
        : '<span style="color: #999;">—</span>';

    row.innerHTML = `
        <td data-label="Funcionario">${esc(solicitud.funcionario)}</td>
        <td data-label="Cargo">${esc(solicitud.cargo)}</td>
        <td data-label="Fecha Inicio">${formatearFecha(solicitud.fechaInicio)}</td>
        <td data-label="Fecha Final">${formatearFecha(solicitud.fechaFinal)}</td>
        <td data-label="Días Totales">${solicitud.diasTotales}</td>
        <td data-label="Estado">${obtenerBadgeEstado(solicitud.estado)}</td>
        <td data-label="Acción">${accionBtn}</td>
    `;
    return row;
}

function renderizarTabla(solicitudes) {
    solicitudesTableBody.innerHTML = '';

    if (solicitudes.length === 0) {
        solicitudesTableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align:center; padding: 20px;">
                    No se encontraron solicitudes con los criterios especificados.
                </td>
            </tr>`;
        return;
    }

    solicitudes.forEach(s => solicitudesTableBody.appendChild(crearFilaTabla(s)));
}

// ======================================== FUNCIONES DE FILTRADO ========================================

function buscarSolicitudes() {
    const funcionario = funcionarioSearchInput.value.toLowerCase().trim();
    const fechaDesde  = fechaDesdeInput.value;
    const fechaHasta  = fechaHastaInput.value;

    solicitudesFiltradas = solicitudesVacaciones.filter(s => {
        const matchNombre    = s.funcionario.toLowerCase().includes(funcionario);
        const matchFechaDesde = !fechaDesde || s.fechaInicio >= fechaDesde;
        const matchFechaHasta = !fechaHasta || s.fechaInicio <= fechaHasta;
        return matchNombre && matchFechaDesde && matchFechaHasta;
    });

    renderizarTabla(solicitudesFiltradas);
}

function limpiarBusqueda() {
    funcionarioSearchInput.value = '';
    fechaDesdeInput.value = '';
    fechaHastaInput.value = '';
    solicitudesFiltradas = [...solicitudesVacaciones];
    renderizarTabla(solicitudesFiltradas);
}

// ======================================== FUNCIONES DEL MODAL ========================================

function abrirModalAnulacion(idSolicitud) {
    solicitudSeleccionada = solicitudesVacaciones.find(s => s.id === idSolicitud);

    if (!solicitudSeleccionada) {
        AppDialog.alert('Error: No se encontró la solicitud', {
            title: 'Solicitud no encontrada', icon: 'error', variant: 'danger',
        });
        return;
    }

    modalFuncionario.textContent = solicitudSeleccionada.funcionario;
    modalCargo.textContent       = solicitudSeleccionada.cargo;
    modalFechaInicio.textContent = formatearFecha(solicitudSeleccionada.fechaInicio);
    modalFechaFinal.textContent  = formatearFecha(solicitudSeleccionada.fechaFinal);
    modalDiasTotales.textContent = solicitudSeleccionada.diasTotales;
    modalSaldoActual.textContent = solicitudSeleccionada.saldoActual;

    [nuevaFechaInicioInput, nuevaFechaFinalInput].forEach(input => {
        input.min = solicitudSeleccionada.fechaInicio;
        input.max = solicitudSeleccionada.fechaFinal;
    });

    limpiarFormularioAnulacion();
    modalAnulacion.classList.add('show');
}

function cerrarModalAnulacion() {
    modalAnulacion.classList.remove('show');
    solicitudSeleccionada = null;
}

function limpiarFormularioAnulacion() {
    tipoAnulacionSelect.value   = '';
    motivoAnulacionSelect.value = '';
    observacionesTextarea.value = '';
    fechasParcialGroup.hidden   = true;
    nuevaFechaInicioInput.value = solicitudSeleccionada.fechaInicio;
    nuevaFechaFinalInput.value  = solicitudSeleccionada.fechaFinal;
    actualizarResumen();
}

function actualizarResumen() {
    if (!solicitudSeleccionada) return;

    const tipo = tipoAnulacionSelect.value;
    let diasDevolver = 0;

    if (tipo === 'total') {
        diasDevolver = solicitudSeleccionada.diasTotales;
    } else if (tipo === 'parcial') {
        diasDevolver = diasDevolverParcial() ?? 0;
    }

    diasDevolverSpan.textContent = diasDevolver;
    nuevoSaldoSpan.textContent   = solicitudSeleccionada.saldoActual + diasDevolver;
}

// null si las fechas no forman un período válido dentro del original.
function diasDevolverParcial() {
    const s = solicitudSeleccionada;
    const inicio = nuevaFechaInicioInput.value;
    const final  = nuevaFechaFinalInput.value;
    if (!inicio || !final || inicio < s.fechaInicio || final > s.fechaFinal || inicio >= final) return null;
    const restantes = Math.min(contarDiasHabiles(inicio, final), s.diasTotales);
    return restantes > 0 ? s.diasTotales - restantes : null;
}

function validarFormulario() {
    const tipo         = tipoAnulacionSelect.value;
    const motivo       = motivoAnulacionSelect.value;
    const observaciones = observacionesTextarea.value.trim();

    if (!tipo) {
        AppDialog.alert('Por favor, seleccione el tipo de anulación');
        return false;
    }

    if (tipo === 'parcial' && !diasDevolverParcial()) {
        AppDialog.alert(
            `Indique un nuevo período dentro de ${formatearFecha(solicitudSeleccionada.fechaInicio)} – ` +
            `${formatearFecha(solicitudSeleccionada.fechaFinal)} que conserve al menos un día hábil y libere alguno.`
        );
        return false;
    }

    if (!motivo) {
        AppDialog.alert('Por favor, seleccione el motivo de la anulación');
        return false;
    }

    if (!observaciones) {
        AppDialog.alert('Describa el motivo de la anulación en Observaciones');
        return false;
    }

    return true;
}

function abrirModalConfirmacion() {
    if (!validarFormulario()) return;

    const s       = solicitudSeleccionada;
    const parcial = tipoAnulacionSelect.value === 'parcial';
    const fila    = (label, valor) => `
        <div class="confirm-row">
            <span class="confirm-label">${label}</span>
            <span class="confirm-value">${valor}</span>
        </div>`;

    confirmDetalles.innerHTML =
        fila('Funcionario', esc(s.funcionario)) +
        fila('Tipo', parcial ? 'Anulación Parcial' : 'Anulación Total') +
        (parcial
            ? fila('Nuevo período', `${formatearFecha(nuevaFechaInicioInput.value)} – ${formatearFecha(nuevaFechaFinalInput.value)}`)
            : fila('Período', `${formatearFecha(s.fechaInicio)} – ${formatearFecha(s.fechaFinal)}`)) +
        fila('Días a devolver', diasDevolverSpan.textContent);

    modalConfirmacion.classList.add('show');
}

function cerrarModalConfirmacion() {
    modalConfirmacion.classList.remove('show');
}

// ======================================== PROCESAMIENTO (API) ========================================

async function procesarAnulacion() {
    const tipo          = tipoAnulacionSelect.value;
    const motivo        = motivoAnulacionSelect.value;
    const observaciones = observacionesTextarea.value.trim();

    try {
        const resp = await fetch('/api/vacaciones/anulacion/registrar/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': _csrf(),
            },
            body: JSON.stringify({
                id_formulario:   solicitudSeleccionada.id,
                tipo_anulacion:  tipo,
                motivo_anulacion: motivo,
                observaciones,
                nueva_fecha_inicio: nuevaFechaInicioInput.value,
                nueva_fecha_final:  nuevaFechaFinalInput.value,
            }),
        });

        const data = await resp.json();

        if (!resp.ok || data.error) {
            AppDialog.alert(data.error || 'Error al procesar la anulación', {
                title: 'Error', icon: 'error', variant: 'danger',
            });
            return;
        }

        cerrarModalConfirmacion();
        cerrarModalAnulacion();
        const diasDevueltos = data.dias_devueltos;

        // Recargar la lista desde el servidor para reflejar el estado real
        await _cargarSolicitudes();

        AppDialog.alert(
            `Anulación procesada. Se devolvieron ${diasDevueltos} día(s) al saldo del funcionario.`,
            { title: 'Operación completada', icon: 'check_circle', variant: 'success' }
        );

    } catch (e) {
        AppDialog.alert('Error de red al procesar la anulación.', {
            title: 'Error', icon: 'error', variant: 'danger',
        });
    }
}

// ======================================== CARGA DE DATOS ========================================

async function _cargarSolicitudes() {
    try {
        const resp = await fetch('/api/vacaciones/anulacion/');
        if (!resp.ok) {
            console.error('Error al cargar solicitudes:', resp.status);
            return;
        }
        const data = await resp.json();
        if (data.error) {
            console.error('Error del servidor:', data.error);
            return;
        }

        solicitudesVacaciones = data.solicitudes || [];
        feriados              = new Set(data.feriados || []);
        solicitudesFiltradas  = [...solicitudesVacaciones];
        renderizarTabla(solicitudesFiltradas);

        window.initProfileSwitcher?.({ roles: data.usuario.roles, nombre: data.usuario.nombre });
        window.setupProfileToggle?.();

    } catch (e) {
        console.error('Error en _cargarSolicitudes:', e);
    }
}

// ======================================== EVENT LISTENERS ========================================

btnBuscar.addEventListener('click', buscarSolicitudes);
btnLimpiarBusqueda.addEventListener('click', limpiarBusqueda);

funcionarioSearchInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') buscarSolicitudes();
});

// Filtro dinámico en tiempo real
funcionarioSearchInput.addEventListener('input', buscarSolicitudes);
fechaDesdeInput.addEventListener('change', buscarSolicitudes);
fechaHastaInput.addEventListener('change', buscarSolicitudes);

btnCerrarModal.addEventListener('click', cerrarModalAnulacion);
btnCancelar.addEventListener('click', cerrarModalAnulacion);

tipoAnulacionSelect.addEventListener('change', () => {
    fechasParcialGroup.hidden = tipoAnulacionSelect.value !== 'parcial';
    actualizarResumen();
});

nuevaFechaInicioInput.addEventListener('change', actualizarResumen);
nuevaFechaFinalInput.addEventListener('change', actualizarResumen);
btnConfirmarAnulacion.addEventListener('click', abrirModalConfirmacion);
btnCancelarConfirmacion.addEventListener('click', cerrarModalConfirmacion);
btnConfirmarFinal.addEventListener('click', procesarAnulacion);

window.addEventListener('click', event => {
    if (event.target === modalAnulacion)     cerrarModalAnulacion();
    if (event.target === modalConfirmacion)  cerrarModalConfirmacion();
});

window.abrirModalAnulacion = abrirModalAnulacion;

// ======================================== INICIALIZACIÓN ========================================

document.addEventListener('DOMContentLoaded', () => {
    _cargarSolicitudes();
});
