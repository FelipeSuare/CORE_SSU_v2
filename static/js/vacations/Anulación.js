// ======================================== DATOS DE PRUEBA SIMULADOS ========================================
// Estos datos simulan solicitudes de vacaciones activas que pueden ser anuladas
const solicitudesVacaciones = [
    { 
        id: 1, 
        funcionario: 'Juan Pérez', 
        cargo: 'Analista Contable', 
        fechaInicio: '2025-12-15', 
        fechaFinal: '2025-12-29', 
        diasTotales: 10, 
        saldoActual: 20, 
        estado: 'activa' 
    },
    { 
        id: 2, 
        funcionario: 'María Gómez', 
        cargo: 'Médico General', 
        fechaInicio: '2026-01-05', 
        fechaFinal: '2026-01-11', 
        diasTotales: 5, 
        saldoActual: 25, 
        estado: 'activa' 
    },
    { 
        id: 3, 
        funcionario: 'Carlos Mesa', 
        cargo: 'Auxiliar RRHH', 
        fechaInicio: '2026-02-01', 
        fechaFinal: '2026-02-22', 
        diasTotales: 15, 
        saldoActual: 15, 
        estado: 'activa' 
    },
    { 
        id: 4, 
        funcionario: 'Ana Vaca', 
        cargo: 'Enfermera', 
        fechaInicio: '2025-12-20', 
        fechaFinal: '2025-12-30', 
        diasTotales: 7, 
        saldoActual: 23, 
        estado: 'activa' 
    },
    { 
        id: 5, 
        funcionario: 'Pedro Roca', 
        cargo: 'Jefe Administrativo', 
        fechaInicio: '2025-11-01', 
        fechaFinal: '2025-11-20', 
        diasTotales: 14, 
        saldoActual: 16, 
        estado: 'completada' 
    },
];

// ======================================== VARIABLES GLOBALES ========================================
let solicitudSeleccionada = null;
let solicitudesFiltradas = [...solicitudesVacaciones];

// ======================================== ELEMENTOS DEL DOM ========================================
const funcionarioSearchInput = document.getElementById('funcionarioSearch');
const fechaDesdeInput = document.getElementById('fechaDesde');
const fechaHastaInput = document.getElementById('fechaHasta');
const btnBuscar = document.getElementById('btnBuscar');
const btnLimpiarBusqueda = document.getElementById('btnLimpiarBusqueda');
const solicitudesTableBody = document.getElementById('solicitudesTableBody');

// Modal de Anulación
const modalAnulacion = document.getElementById('modalAnulacion');
const btnCerrarModal = document.getElementById('btnCerrarModal');
const btnCancelar = document.getElementById('btnCancelar');

// Elementos del formulario del modal
const tipoAnulacionSelect = document.getElementById('tipoAnulacion');
const diasAnularGroup = document.getElementById('diasAnularGroup');
const diasAnularInput = document.getElementById('diasAnular');
const maxDiasAnularSpan = document.getElementById('maxDiasAnular');
const motivoAnulacionSelect = document.getElementById('motivoAnulacion');
const observacionesTextarea = document.getElementById('observaciones');
const btnConfirmarAnulacion = document.getElementById('btnConfirmarAnulacion');

// Elementos de información en el modal
const modalFuncionario = document.getElementById('modalFuncionario');
const modalCargo = document.getElementById('modalCargo');
const modalFechaInicio = document.getElementById('modalFechaInicio');
const modalFechaFinal = document.getElementById('modalFechaFinal');
const modalDiasTotales = document.getElementById('modalDiasTotales');
const modalSaldoActual = document.getElementById('modalSaldoActual');

// Elementos del resumen
const diasDevolverSpan = document.getElementById('diasDevolver');
const nuevoSaldoSpan = document.getElementById('nuevoSaldo');

// Modal de Confirmación
const modalConfirmacion = document.getElementById('modalConfirmacion');
const btnCancelarConfirmacion = document.getElementById('btnCancelarConfirmacion');
const btnConfirmarFinal = document.getElementById('btnConfirmarFinal');
const confirmTipoSpan = document.getElementById('confirmTipo');
const confirmDiasSpan = document.getElementById('confirmDias');

// ======================================== FUNCIONES DE UTILIDAD ========================================

/**
 * Formatea una fecha en formato ISO (YYYY-MM-DD) a formato legible (DD/MM/YYYY)
 */
function formatearFecha(fechaISO) {
    const [año, mes, dia] = fechaISO.split('-');
    return `${dia}/${mes}/${año}`;
}

/**
 * Obtiene el badge HTML según el estado de la solicitud
 */
function obtenerBadgeEstado(estado) {
    const badges = {
        'activa': '<span class="badge badge-activa">Activa</span>',
        'completada': '<span class="badge badge-completada">Completada</span>',
        'anulada': '<span class="badge badge-anulada">Anulada</span>'
    };
    return badges[estado] || estado;
}

// ======================================== FUNCIONES DE RENDERIZADO ========================================

/**
 * Crea una fila de la tabla con los datos de una solicitud
 */
function crearFilaTabla(solicitud) {
    const row = document.createElement('tr');
    
    const accionBtn = solicitud.estado === 'activa' 
        ? `<button class="action-btn action-btn-edit" onclick="abrirModalAnulacion(${solicitud.id})">
                <i class="material-symbols-outlined">receipt_long_off</i> Anular
           </button>`
        : '<span style="color: #999;">—</span>';
    
    row.innerHTML = `
        <td data-label="Funcionario">${solicitud.funcionario}</td>
        <td data-label="Cargo">${solicitud.cargo}</td>
        <td data-label="Fecha Inicio">${formatearFecha(solicitud.fechaInicio)}</td>
        <td data-label="Fecha Final">${formatearFecha(solicitud.fechaFinal)}</td>
        <td data-label="Días Totales">${solicitud.diasTotales}</td>
        <td data-label="Estado">${obtenerBadgeEstado(solicitud.estado)}</td>
        <td data-label="Acción">${accionBtn}</td>
    `;
    return row;
}

/**
 * Renderiza la tabla de solicitudes
 */
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
    
    solicitudes.forEach(solicitud => {
        solicitudesTableBody.appendChild(crearFilaTabla(solicitud));
    });
}

// ======================================== FUNCIONES DE FILTRADO ========================================

/**
 * Filtra las solicitudes según los criterios de búsqueda
 */
function buscarSolicitudes() {
    const funcionario = funcionarioSearchInput.value.toLowerCase().trim();
    const fechaDesde = fechaDesdeInput.value;
    const fechaHasta = fechaHastaInput.value;
    
    solicitudesFiltradas = solicitudesVacaciones.filter(solicitud => {
        const matchFuncionario = solicitud.funcionario.toLowerCase().includes(funcionario);
        
        const matchFechaDesde = !fechaDesde || solicitud.fechaInicio >= fechaDesde;
        const matchFechaHasta = !fechaHasta || solicitud.fechaInicio <= fechaHasta;
        
        return matchFuncionario && matchFechaDesde && matchFechaHasta;
    });
    
    renderizarTabla(solicitudesFiltradas);
    console.log(`Búsqueda completada: ${solicitudesFiltradas.length} solicitudes encontradas`);
}

/**
 * Limpia los filtros de búsqueda
 */
function limpiarBusqueda() {
    funcionarioSearchInput.value = '';
    fechaDesdeInput.value = '';
    fechaHastaInput.value = '';
    
    solicitudesFiltradas = [...solicitudesVacaciones];
    renderizarTabla(solicitudesFiltradas);
    console.log('Filtros limpiados');
}

// ======================================== FUNCIONES DEL MODAL ========================================

/**
 * Abre el modal de anulación con los datos de la solicitud seleccionada
 */
function abrirModalAnulacion(idSolicitud) {
    solicitudSeleccionada = solicitudesVacaciones.find(s => s.id === idSolicitud);
    
    if (!solicitudSeleccionada) {
        AppDialog.alert('Error: No se encontro la solicitud', {
            title: 'Solicitud no encontrada',
            icon: 'error',
            variant: 'danger'
        });
        return;
    }
    
    // Llenar información de la solicitud
    modalFuncionario.textContent = solicitudSeleccionada.funcionario;
    modalCargo.textContent = solicitudSeleccionada.cargo;
    modalFechaInicio.textContent = formatearFecha(solicitudSeleccionada.fechaInicio);
    modalFechaFinal.textContent = formatearFecha(solicitudSeleccionada.fechaFinal);
    modalDiasTotales.textContent = solicitudSeleccionada.diasTotales;
    modalSaldoActual.textContent = solicitudSeleccionada.saldoActual;
    
    // Configurar máximo de días a anular
    maxDiasAnularSpan.textContent = solicitudSeleccionada.diasTotales;
    diasAnularInput.max = solicitudSeleccionada.diasTotales;
    
    // Limpiar formulario
    limpiarFormularioAnulacion();
    
    // Mostrar modal
    modalAnulacion.classList.add('show');
}

/**
 * Cierra el modal de anulación
 */
function cerrarModalAnulacion() {
    modalAnulacion.classList.remove('show');
    solicitudSeleccionada = null;
}

/**
 * Limpia el formulario de anulación
 */
function limpiarFormularioAnulacion() {
    tipoAnulacionSelect.value = '';
    diasAnularInput.value = '';
    motivoAnulacionSelect.value = '';
    observacionesTextarea.value = '';
    diasAnularGroup.style.display = 'none';
    actualizarResumen();
}

/**
 * Actualiza el resumen del ajuste
 */
function actualizarResumen() {
    if (!solicitudSeleccionada) return;
    
    const tipoAnulacion = tipoAnulacionSelect.value;
    let diasDevolver = 0;
    
    if (tipoAnulacion === 'total') {
        diasDevolver = solicitudSeleccionada.diasTotales;
    } else if (tipoAnulacion === 'parcial') {
        diasDevolver = parseInt(diasAnularInput.value) || 0;
    }
    
    const nuevoSaldo = solicitudSeleccionada.saldoActual + diasDevolver;
    
    diasDevolverSpan.textContent = diasDevolver;
    nuevoSaldoSpan.textContent = nuevoSaldo;
}

/**
 * Valida el formulario de anulación
 */
function validarFormulario() {
    const tipoAnulacion = tipoAnulacionSelect.value;
    const motivo = motivoAnulacionSelect.value;
    const observaciones = observacionesTextarea.value.trim();
    
    if (!tipoAnulacion) {
        AppDialog.alert('Por favor, seleccione el tipo de anulacion');
        return false;
    }
    
    if (tipoAnulacion === 'parcial') {
        const diasAnular = parseInt(diasAnularInput.value);
        if (!diasAnular || diasAnular < 1 || diasAnular > solicitudSeleccionada.diasTotales) {
            AppDialog.alert(`Por favor, ingrese un numero valido de dias (1-${solicitudSeleccionada.diasTotales})`);
            return false;
        }
    }
    
    if (!motivo) {
        AppDialog.alert('Por favor, seleccione el motivo de la anulacion');
        return false;
    }
    
    if (!observaciones || observaciones.length < 20) {
        AppDialog.alert('Por favor, describa detalladamente el motivo (minimo 20 caracteres)');
        return false;
    }
    
    return true;
}

/**
 * Abre el modal de confirmación
 */
function abrirModalConfirmacion() {
    if (!validarFormulario()) return;
    
    const tipoAnulacion = tipoAnulacionSelect.value;
    const diasDevolver = parseInt(diasDevolverSpan.textContent);
    
    confirmTipoSpan.textContent = tipoAnulacion === 'total' ? 'Anulación Total' : 'Anulación Parcial';
    confirmDiasSpan.textContent = diasDevolver;
    
    modalConfirmacion.classList.add('show');
}

/**
 * Cierra el modal de confirmación
 */
function cerrarModalConfirmacion() {
    modalConfirmacion.classList.remove('show');
}

/**
 * Procesa la anulación confirmada
 */
function procesarAnulacion() {
    const tipoAnulacion = tipoAnulacionSelect.value;
    const diasDevolver = parseInt(diasDevolverSpan.textContent);
    const motivo = motivoAnulacionSelect.value;
    const observaciones = observacionesTextarea.value.trim();
    
    // Simular procesamiento
    console.log('=== PROCESANDO ANULACIÓN ===');
    console.log('Solicitud ID:', solicitudSeleccionada.id);
    console.log('Funcionario:', solicitudSeleccionada.funcionario);
    console.log('Tipo:', tipoAnulacion);
    console.log('Días a devolver:', diasDevolver);
    console.log('Motivo:', motivo);
    console.log('Observaciones:', observaciones);
    
    // Actualizar el estado de la solicitud
    solicitudSeleccionada.estado = tipoAnulacion === 'total' ? 'anulada' : 'activa';
    if (tipoAnulacion === 'parcial') {
        solicitudSeleccionada.diasTotales -= diasDevolver;
    }
    solicitudSeleccionada.saldoActual += diasDevolver;
    
    // Cerrar modales
    cerrarModalConfirmacion();
    cerrarModalAnulacion();
    
    // Actualizar tabla
    renderizarTabla(solicitudesFiltradas);
    
    // Mostrar mensaje de éxito
    AppDialog.alert(`✓ Anulacion procesada exitosamente\n\nSe han devuelto ${diasDevolver} dias al funcionario ${solicitudSeleccionada.funcionario}\nNuevo saldo: ${solicitudSeleccionada.saldoActual} dias`, {
        title: 'Operacion completada',
        icon: 'check_circle',
        variant: 'success'
    });
}

// ======================================== EVENT LISTENERS ========================================

// Búsqueda
btnBuscar.addEventListener('click', buscarSolicitudes);
btnLimpiarBusqueda.addEventListener('click', limpiarBusqueda);

// Enter en el campo de búsqueda
funcionarioSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') buscarSolicitudes();
});

// Modal de Anulación
btnCerrarModal.addEventListener('click', cerrarModalAnulacion);
btnCancelar.addEventListener('click', cerrarModalAnulacion);

// Tipo de anulación
tipoAnulacionSelect.addEventListener('change', () => {
    const tipo = tipoAnulacionSelect.value;
    if (tipo === 'parcial') {
        diasAnularGroup.style.display = 'block';
        diasAnularInput.value = '';
    } else {
        diasAnularGroup.style.display = 'none';
    }
    actualizarResumen();
});

// Días a anular
diasAnularInput.addEventListener('input', actualizarResumen);

// Confirmar anulación
btnConfirmarAnulacion.addEventListener('click', abrirModalConfirmacion);

// Modal de Confirmación
btnCancelarConfirmacion.addEventListener('click', cerrarModalConfirmacion);
btnConfirmarFinal.addEventListener('click', procesarAnulacion);

// Cerrar modales al hacer clic fuera de ellos
window.addEventListener('click', (event) => {
    if (event.target === modalAnulacion) {
        cerrarModalAnulacion();
    }
    if (event.target === modalConfirmacion) {
        cerrarModalConfirmacion();
    }
});

// Hacer la función accesible globalmente para el onclick en el HTML
window.abrirModalAnulacion = abrirModalAnulacion;

// ══════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    _initPerfil();
    renderizarTabla(solicitudesVacaciones);
});

async function _initPerfil() {
    const csrfMeta = document.querySelector('meta[name="csrf-token"]');
    if (!csrfMeta) return;
    try {
        const resp = await fetch('/api/usuario/mi-perfil/', {
            headers: { 'X-CSRFToken': csrfMeta.content },
        });
        const data = await resp.json();
        if (data.error) return;
        window.initProfileSwitcher?.({ roles: data.roles, nombre: data.nombre_completo });
        window.setupProfileToggle?.();
    } catch (e) {
        console.warn('Profile switcher no disponible:', e);
    }
}