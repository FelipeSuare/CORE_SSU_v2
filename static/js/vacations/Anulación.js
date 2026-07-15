// ======================================== ESTADO ========================================
let solicitudesVacaciones = [];
let solicitudesFiltradas  = [];
let solicitudSeleccionada = null;

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
const diasAnularGroup       = document.getElementById('diasAnularGroup');
const diasAnularInput       = document.getElementById('diasAnular');
const maxDiasAnularSpan     = document.getElementById('maxDiasAnular');
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
const confirmTipoSpan          = document.getElementById('confirmTipo');
const confirmDiasSpan          = document.getElementById('confirmDias');

// ======================================== FUNCIONES DE UTILIDAD ========================================

function formatearFecha(fechaISO) {
    const [año, mes, dia] = fechaISO.split('-');
    return `${dia}/${mes}/${año}`;
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

    maxDiasAnularSpan.textContent = solicitudSeleccionada.diasTotales;
    diasAnularInput.max = solicitudSeleccionada.diasTotales;

    limpiarFormularioAnulacion();
    modalAnulacion.classList.add('show');
}

function cerrarModalAnulacion() {
    modalAnulacion.classList.remove('show');
    solicitudSeleccionada = null;
}

function limpiarFormularioAnulacion() {
    tipoAnulacionSelect.value   = '';
    diasAnularInput.value       = '';
    motivoAnulacionSelect.value = '';
    observacionesTextarea.value = '';
    diasAnularGroup.style.display = 'none';
    actualizarResumen();
}

function actualizarResumen() {
    if (!solicitudSeleccionada) return;

    const tipo = tipoAnulacionSelect.value;
    let diasDevolver = 0;

    if (tipo === 'total') {
        diasDevolver = solicitudSeleccionada.diasTotales;
    } else if (tipo === 'parcial') {
        diasDevolver = parseFloat(diasAnularInput.value) || 0;
    }

    diasDevolverSpan.textContent = diasDevolver;
    nuevoSaldoSpan.textContent   = solicitudSeleccionada.saldoActual + diasDevolver;
}

function validarFormulario() {
    const tipo         = tipoAnulacionSelect.value;
    const motivo       = motivoAnulacionSelect.value;
    const observaciones = observacionesTextarea.value.trim();

    if (!tipo) {
        AppDialog.alert('Por favor, seleccione el tipo de anulación');
        return false;
    }

    if (tipo === 'parcial') {
        const dias = parseFloat(diasAnularInput.value);
        if (!dias || dias < 1 || dias > solicitudSeleccionada.diasTotales) {
            AppDialog.alert(`Ingrese un número válido de días (1-${solicitudSeleccionada.diasTotales})`);
            return false;
        }
    }

    if (!motivo) {
        AppDialog.alert('Por favor, seleccione el motivo de la anulación');
        return false;
    }

    if (!observaciones || observaciones.length < 20) {
        AppDialog.alert('Describa detalladamente el motivo (mínimo 20 caracteres)');
        return false;
    }

    return true;
}

function abrirModalConfirmacion() {
    if (!validarFormulario()) return;

    const tipo        = tipoAnulacionSelect.value;
    const diasDevolver = parseFloat(diasDevolverSpan.textContent);

    confirmTipoSpan.textContent = tipo === 'total' ? 'Anulación Total' : 'Anulación Parcial';
    confirmDiasSpan.textContent = diasDevolver;

    modalConfirmacion.classList.add('show');
}

function cerrarModalConfirmacion() {
    modalConfirmacion.classList.remove('show');
}

// ======================================== PROCESAMIENTO (API) ========================================

async function procesarAnulacion() {
    const tipo          = tipoAnulacionSelect.value;
    const diasDevolver  = parseFloat(diasDevolverSpan.textContent);
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
                dias_devolver:   diasDevolver,
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

        // Recargar la lista desde el servidor para reflejar el estado real
        await _cargarSolicitudes();

        AppDialog.alert(
            `Anulación procesada. Se devolvieron ${diasDevolver} día(s) al saldo del funcionario.`,
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
    diasAnularGroup.style.display = tipoAnulacionSelect.value === 'parcial' ? 'block' : 'none';
    if (tipoAnulacionSelect.value !== 'parcial') diasAnularInput.value = '';
    actualizarResumen();
});

diasAnularInput.addEventListener('input', actualizarResumen);
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
