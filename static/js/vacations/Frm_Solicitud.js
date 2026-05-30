// ======================================== DATOS DE PRUEBA SIMULADOS ========================================
// Estos datos simulan lo que tu backend devolvería.
const allVacationRequests = [
    { cargo: 'Analista Contable', fechaSolicitud: '20/11/2025', fechaInicio: '15/12/2025', dias: 10, fechaFinal: '29/12/2025', saldo: 20, unidad: 'administrativa', contrato: 'item', funcionario: 'Juan Pérez' },
    { cargo: 'Médico General', fechaSolicitud: '15/10/2025', fechaInicio: '05/01/2026', dias: 5, fechaFinal: '11/01/2026', saldo: 25, unidad: 'salud', contrato: 'indefinido', funcionario: 'María Gómez' },
    { cargo: 'Auxiliar RRHH', fechaSolicitud: '01/12/2025', fechaInicio: '01/02/2026', dias: 15, fechaFinal: '22/02/2026', saldo: 15, unidad: 'administrativa', contrato: 'indefinido', funcionario: 'Carlos Mesa' },
    { cargo: 'Enfermera', fechaSolicitud: '10/11/2025', fechaInicio: '20/12/2025', dias: 7, fechaFinal: '30/12/2025', saldo: 23, unidad: 'salud', contrato: 'item', funcionario: 'Ana Vaca' },
    { cargo: 'Jefe Administrativo', fechaSolicitud: '05/10/2025', fechaInicio: '01/03/2026', dias: 20, fechaFinal: '30/03/2026', saldo: 10, unidad: 'administrativa', contrato: 'indefinido', funcionario: 'Pedro Roca' },
];

// ======================================== ELEMENTOS DEL DOM ========================================
const unidadOrgSelect = document.getElementById('unidadOrg');
const tipoContratoSelect = document.getElementById('tipoContrato');
const funcionarioInput = document.getElementById('funcionarioFilter');
const btnFilter = document.getElementById('btnFilter');
const btnClear = document.getElementById('btnClear');
const tableBody = document.getElementById('vacationTableBody');


// ======================================== FUNCIONES DE RENDERIZADO ========================================

/**
 * Crea una fila de la tabla a partir de un objeto de solicitud,
 * incluyendo los atributos data-label para la vista móvil (Card View).
 * @param {object} request - Objeto con los datos de la solicitud.
 */
function createTableRow(request) {
    const row = document.createElement('tr');
    
    // NOTA: Se usan los atributos 'data-label' para mostrar los encabezados en la vista móvil (CSS).
    row.innerHTML = `
        <td data-label="Cargo">${request.cargo}</td>
        <td data-label="Fecha Solicitud">${request.fechaSolicitud}</td>
        <td data-label="Fecha Inicio">${request.fechaInicio}</td>
        <td data-label="Días Solicitados">${request.dias}</td>
        <td data-label="Fecha Final">${request.fechaFinal}</td>
        <td data-label="Saldo de Días Adeudados">${request.saldo}</td>
        <td data-label="Documento PDF">
            <button class="btn-pdf" onclick="downloadPdf('${request.funcionario}', '${request.fechaSolicitud}')">
                <i class="material-symbols-outlined">picture_as_pdf</i>
            </button>
        </td>
    `;
    return row;
}

/**
 * Renderiza la lista de solicitudes en la tabla.
 * @param {Array<object>} requests - Lista de solicitudes a mostrar.
 */
function renderTable(requests) {
    tableBody.innerHTML = ''; // Limpiar la tabla
    if (requests.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px;">No se encontraron solicitudes con los filtros aplicados.</td></tr>';
        return;
    }
    requests.forEach(request => {
        tableBody.appendChild(createTableRow(request));
    });
}

// Función simulada para descargar el PDF
function downloadPdf(funcionario, fecha) {
    AppDialog.alert(`Descargando PDF para la solicitud de ${funcionario}, presentada el ${fecha}.`, {
        title: 'Descarga iniciada',
        icon: 'download'
    });
}
window.downloadPdf = downloadPdf; // Hacer la función accesible globalmente

// ======================================== LÓGICA DE FILTRADO (SIMULACIÓN DE BACKEND) ========================================

/**
 * Función que simula la llamada a tu backend para obtener los datos filtrados.
 */
function fetchData(filters) {
    console.log("--- SIMULACIÓN DE LLAMADA A BACKEND ---");
    console.log("Filtros a enviar a la API:", filters);
    
    // En un entorno real, aquí iría tu función 'fetch' a la API.
    
    // --- LÓGICA DE FILTRADO EN EL FRONTEND (Solo para demostración): ---
    let filteredResults = allVacationRequests.filter(request => {
        const matchUnidad = filters.unidad === 'todos' || request.unidad === filters.unidad;
        const matchContrato = filters.contrato === 'todos' || request.contrato === filters.contrato;
        const matchFuncionario = request.funcionario.toLowerCase().includes(filters.funcionario.toLowerCase());
        
        return matchUnidad && matchContrato && matchFuncionario;
    });

    // Simulamos un retraso de red
    setTimeout(() => {
        renderTable(filteredResults);
        console.log(`Resultados encontrados: ${filteredResults.length}`);
    }, 300); 
}


// ======================================== MANEJADORES DE EVENTOS ========================================

/**
 * 1. Recoge los valores de los filtros y llama a fetchData.
 */
function handleFilter() {
    const filters = {
        unidad: unidadOrgSelect.value,
        contrato: tipoContratoSelect.value,
        funcionario: funcionarioInput.value.trim() 
    };
    
    fetchData(filters);
}

/**
 * 2. Limpia los filtros y renderiza todos los datos.
 */
function handleClear() {
    unidadOrgSelect.value = 'todos';
    tipoContratoSelect.value = 'todos';
    funcionarioInput.value = '';
    
    // Recargar la tabla con todos los datos
    fetchData({
        unidad: 'todos',
        contrato: 'todos',
        funcionario: ''
    });
}

// 3. Event Listeners
btnFilter.addEventListener('click', handleFilter);
btnClear.addEventListener('click', handleClear);

// 4. Inicialización
document.addEventListener('DOMContentLoaded', () => {
    _initPerfil();
    handleClear();
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

/**
 * Renderiza la lista de solicitudes en la tabla.
 * @param {Array<object>} requests - Lista de solicitudes a mostrar.
 */
function renderTable(requests) {
    tableBody.innerHTML = ''; // Limpiar la tabla
    if (requests.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px;">No se encontraron solicitudes con los filtros aplicados.</td></tr>';
        return;
    }
    requests.forEach(request => {
        tableBody.appendChild(createTableRow(request));
    });
}

// Función simulada para descargar el PDF
function downloadPdf(funcionario, fecha) {
    AppDialog.alert(`Descargando PDF para la solicitud de ${funcionario}, presentada el ${fecha}.`, {
        title: 'Descarga iniciada',
        icon: 'download'
    });
}
window.downloadPdf = downloadPdf; // Hacer la función accesible globalmente

// ======================================== LÓGICA DE FILTRADO (SIMULACIÓN DE BACKEND) ========================================

/**
 * 💡 FUNCIÓN CLAVE: Esta función simula la llamada a tu backend.
 * En un entorno real, aquí harías un 'fetch' a tu API.
 */
function fetchData(filters) {
    console.log("--- SIMULACIÓN DE LLAMADA A BACKEND ---");
    console.log("Filtros a enviar a la API:", filters);

    // En un entorno real, harías algo como:
    // fetch(`/api/solicitudes?unidad=${filters.unidad}&contrato=${filters.contrato}&search=${filters.funcionario}`)
    //     .then(response => response.json())
    //     .then(data => renderTable(data));
    
    // --- LÓGICA DE FILTRADO EN EL FRONTEND (Solo para demostración): ---
    
    let filteredResults = allVacationRequests.filter(request => {
        const matchUnidad = filters.unidad === 'todos' || request.unidad === filters.unidad;
        const matchContrato = filters.contrato === 'todos' || request.contrato === filters.contrato;
        const matchFuncionario = request.funcionario.toLowerCase().includes(filters.funcionario.toLowerCase());
        
        return matchUnidad && matchContrato && matchFuncionario;
    });

    // Simulamos un retraso de red
    setTimeout(() => {
        renderTable(filteredResults);
        console.log(`Resultados encontrados: ${filteredResults.length}`);
    }, 300); 
}


// ======================================== MANEJADORES DE EVENTOS ========================================

/**
 * 1. Recoge los valores de los filtros y llama a fetchData.
 */
function handleFilter() {
    const filters = {
        unidad: unidadOrgSelect.value,
        contrato: tipoContratoSelect.value,
        funcionario: funcionarioInput.value.trim() 
    };
    
    fetchData(filters);
}

/**
 * 2. Limpia los filtros y renderiza todos los datos.
 */
function handleClear() {
    unidadOrgSelect.value = 'todos';
    tipoContratoSelect.value = 'todos';
    funcionarioInput.value = '';
    
    // Recargar la tabla con todos los datos
    fetchData({
        unidad: 'todos',
        contrato: 'todos',
        funcionario: ''
    });
}

// 3. Asignación de Event Listeners a los botones
btnFilter.addEventListener('click', handleFilter);
btnClear.addEventListener('click', handleClear);

// 4. Inicialización: Cargar la tabla al iniciar
document.addEventListener('DOMContentLoaded', () => {
    handleClear(); // Carga la tabla con todos los datos por defecto
});