// ═══════════════════════════════════════════════════════════════
//  Configuración desde meta-tags inyectados por Django
// ═══════════════════════════════════════════════════════════════
const CSRF_TOKEN  = document.querySelector('meta[name="csrf-token"]').content;
const URL_LISTA   = document.querySelector('meta[name="url-lista"]').content;
const URL_AGREGAR = document.querySelector('meta[name="url-agregar"]').content;
const URL_BASE    = document.querySelector('meta[name="url-base-feriado"]').content;

const editarUrl   = id => `${URL_BASE}${id}/editar/`;
const eliminarUrl = id => `${URL_BASE}${id}/eliminar/`;

// ═══════════════════════════════════════════════════════════════
//  Elementos del DOM
// ═══════════════════════════════════════════════════════════════
const addForm             = document.getElementById('newHolidayForm');
const dateInput           = document.getElementById('holidayDate');
const descInput           = document.getElementById('holidayDescription');
const typeSelect          = document.getElementById('holidayType');

const tableBody           = document.getElementById('holidaysTableBody');
const searchYearInput     = document.getElementById('searchYear');
const searchTypeSelect    = document.getElementById('searchType');
const btnBuscar           = document.getElementById('btnBuscar');

const modalOverlay        = document.getElementById('modalOverlay');
const formModal           = document.getElementById('formModal');
const modalForm           = document.getElementById('modalForm');
const closeModalBtn       = document.getElementById('closeModalBtn');
const holidayIdInput      = document.getElementById('holidayId');
const modalDateInput      = document.getElementById('modalDate');
const modalTypeSelect     = document.getElementById('modalType');
const modalDescTextarea   = document.getElementById('modalDescription');
const saveModalBtn        = document.getElementById('saveModalBtn');

const modalConfirmOverlay = document.getElementById('modalConfirm');
const confirmDeleteBtn    = document.getElementById('confirmDeleteBtn');
const cancelDeleteBtn     = document.getElementById('cancelDeleteBtn');

let pendingDeleteId = null;

// ═══════════════════════════════════════════════════════════════
//  Inicialización
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    _initPerfil();
    buscarFeriados();
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

// ═══════════════════════════════════════════════════════════════
//  Buscar / listar feriados
// ═══════════════════════════════════════════════════════════════
async function buscarFeriados() {
    const anio = searchYearInput.value.trim();
    const tipo = searchTypeSelect.value;

    const params = new URLSearchParams({ anio, tipo });

    try {
        const resp = await fetch(`${URL_LISTA}?${params}`, {
            headers: { 'X-CSRFToken': CSRF_TOKEN },
        });
        const data = await resp.json();
        renderTabla(data.feriados || []);
    } catch {
        AppDialog.alert('Error al cargar los feriados. Intente nuevamente.', {
            title: 'Error de conexión', icon: 'wifi_off',
        });
    }
}

btnBuscar.addEventListener('click', buscarFeriados);
searchTypeSelect.addEventListener('change', buscarFeriados);

// ═══════════════════════════════════════════════════════════════
//  Renderizar tabla
// ═══════════════════════════════════════════════════════════════
function renderTabla(feriados) {
    tableBody.innerHTML = '';

    if (feriados.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;color:var(--color-pink-dark);padding:20px;">
                    No se encontraron feriados para los filtros seleccionados.
                </td>
            </tr>`;
        return;
    }

    feriados.forEach((f, i) => {
        const tr = tableBody.insertRow();
        tr.insertCell().textContent = i + 1;
        tr.insertCell().textContent = formatearFecha(f.fecha);
        tr.insertCell().textContent = f.descripcion;
        tr.insertCell().textContent = f.tipo;

        const td = tr.insertCell();
        td.innerHTML = `
            <button class="action-btn action-btn-edit btn-edit"   title="Editar"   data-id="${f.id}">
                <i class="material-symbols-outlined">edit</i>
            </button>
            <button class="action-btn action-btn-delete btn-delete" title="Eliminar" data-id="${f.id}">
                <i class="material-symbols-outlined">delete</i>
            </button>`;
    });
}

function formatearFecha(isoDate) {
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
}

// ═══════════════════════════════════════════════════════════════
//  Agregar feriado
// ═══════════════════════════════════════════════════════════════
addForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fecha       = dateInput.value.trim();
    const descripcion = descInput.value.trim();
    const tipo        = typeSelect.value;

    if (!fecha || !descripcion || !tipo) {
        AppDialog.alert('Todos los campos son obligatorios.', { title: 'Campos incompletos', icon: 'warning' });
        return;
    }

    try {
        const resp = await fetch(URL_AGREGAR, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF_TOKEN },
            body: JSON.stringify({ fecha, descripcion, tipo }),
        });
        const data = await resp.json();

        if (!resp.ok) {
            AppDialog.alert(data.error || 'Error al agregar el feriado.', { title: 'Error', icon: 'error' });
            return;
        }

        addForm.reset();
        await buscarFeriados();
        AppDialog.alert('El feriado ha sido registrado exitosamente.', {
            title: 'Registro guardado', icon: 'check_circle', variant: 'success',
        });
    } catch {
        AppDialog.alert('Error de conexión. Intente nuevamente.', { title: 'Sin conexión', icon: 'wifi_off' });
    }
});

// ═══════════════════════════════════════════════════════════════
//  Abrir modal de edición
// ═══════════════════════════════════════════════════════════════
tableBody.addEventListener('click', (e) => {
    const btnEdit   = e.target.closest('.btn-edit');
    const btnDelete = e.target.closest('.btn-delete');

    if (btnEdit) {
        const id = parseInt(btnEdit.dataset.id);
        abrirModalEdicion(id);
    } else if (btnDelete) {
        pendingDeleteId = parseInt(btnDelete.dataset.id);
        modalConfirmOverlay.classList.add('active');
        document.getElementById('confirmModal').classList.add('active');
    }
});

async function abrirModalEdicion(id) {
    // Precarga los datos del feriado desde el registro actual de la tabla
    const fila    = tableBody.querySelector(`[data-id="${id}"]`)?.closest('tr');
    if (!fila) return;

    // Los datos ya están en la tabla — los leemos de la fila para no hacer otra petición
    const celdas  = fila.querySelectorAll('td');
    const fechaDMY = celdas[1].textContent.trim();  // DD/MM/YYYY
    const [d, m, y] = fechaDMY.split('/');

    holidayIdInput.value        = id;
    modalDateInput.value        = `${y}-${m}-${d}`;           // YYYY-MM-DD para <input type="date">
    modalDescTextarea.value     = celdas[2].textContent.trim();
    modalTypeSelect.value       = celdas[3].textContent.trim();

    modalOverlay.classList.add('active');
    formModal.classList.add('active');
}

// Cerrar modal de edición
closeModalBtn.addEventListener('click', cerrarModalEdicion);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) cerrarModalEdicion(); });

function cerrarModalEdicion() {
    modalOverlay.classList.remove('active');
    formModal.classList.remove('active');
    modalForm.reset();
}

// ═══════════════════════════════════════════════════════════════
//  Guardar edición
// ═══════════════════════════════════════════════════════════════
modalForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id          = parseInt(holidayIdInput.value);
    const fecha       = modalDateInput.value.trim();
    const descripcion = modalDescTextarea.value.trim();
    const tipo        = modalTypeSelect.value;

    if (!fecha || !descripcion || !tipo) {
        AppDialog.alert('Todos los campos son obligatorios.', { title: 'Campos incompletos', icon: 'warning' });
        return;
    }

    saveModalBtn.disabled = true;

    try {
        const resp = await fetch(editarUrl(id), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF_TOKEN },
            body: JSON.stringify({ fecha, descripcion, tipo }),
        });
        const data = await resp.json();

        if (!resp.ok) {
            AppDialog.alert(data.error || 'Error al actualizar el feriado.', { title: 'Error', icon: 'error' });
            return;
        }

        cerrarModalEdicion();
        await buscarFeriados();
        AppDialog.alert('El feriado ha sido actualizado exitosamente.', {
            title: 'Actualización guardada', icon: 'check_circle', variant: 'success',
        });
    } catch {
        AppDialog.alert('Error de conexión. Intente nuevamente.', { title: 'Sin conexión', icon: 'wifi_off' });
    } finally {
        saveModalBtn.disabled = false;
    }
});

// ═══════════════════════════════════════════════════════════════
//  Confirmar eliminación
// ═══════════════════════════════════════════════════════════════
cancelDeleteBtn.addEventListener('click', () => {
    modalConfirmOverlay.classList.remove('active');
    document.getElementById('confirmModal').classList.remove('active');
    pendingDeleteId = null;
});

confirmDeleteBtn.addEventListener('click', async () => {
    if (pendingDeleteId === null) return;

    const id = pendingDeleteId;
    confirmDeleteBtn.disabled = true;

    try {
        const resp = await fetch(eliminarUrl(id), {
            method: 'POST',
            headers: { 'X-CSRFToken': CSRF_TOKEN },
        });
        const data = await resp.json();

        if (!resp.ok) {
            AppDialog.alert(data.error || 'Error al eliminar el feriado.', { title: 'Error', icon: 'error' });
            return;
        }

        modalConfirmOverlay.classList.remove('active');
        document.getElementById('confirmModal').classList.remove('active');
        pendingDeleteId = null;
        await buscarFeriados();
        AppDialog.alert('El feriado ha sido eliminado exitosamente.', {
            title: 'Eliminación exitosa', icon: 'delete', variant: 'danger',
        });
    } catch {
        AppDialog.alert('Error de conexión. Intente nuevamente.', { title: 'Sin conexión', icon: 'wifi_off' });
    } finally {
        confirmDeleteBtn.disabled = false;
    }
});
