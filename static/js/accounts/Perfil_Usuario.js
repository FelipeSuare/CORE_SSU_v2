// ═══════════════════════════════════════════════════════════════
//  Configuración leída desde meta-tags inyectados por Django
// ═══════════════════════════════════════════════════════════════
const CSRF_TOKEN     = document.querySelector('meta[name="csrf-token"]').content;
const FOTO_URL       = document.querySelector('meta[name="foto-url"]').content;
const FOTO_DEL_URL   = document.querySelector('meta[name="foto-eliminar-url"]').content;
const PLACEHOLDER_URL = document.querySelector('meta[name="placeholder-url"]').content;

// ═══════════════════════════════════════════════════════════════
//  Elementos del DOM
// ═══════════════════════════════════════════════════════════════
const profilePhoto      = document.getElementById('profilePhoto');
const photoOverlay      = document.getElementById('photoOverlay');
const photoInput        = document.getElementById('photoInput');
const btnUpload         = document.getElementById('btnUpload');
const btnRemove         = document.getElementById('btnRemove');
const rolesContainer    = document.getElementById('rolesContainer');
const btnToggleRoles    = document.getElementById('btnToggleRoles');
const historialContainer = document.getElementById('historialContainer');
const btnToggleHistorial = document.getElementById('btnToggleHistorial');

// ═══════════════════════════════════════════════════════════════
//  Foto de perfil — subir
// ═══════════════════════════════════════════════════════════════
btnUpload.addEventListener('click', () => photoInput.click());
photoOverlay.addEventListener('click', () => photoInput.click());

photoInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        AppDialog.alert('Solo se aceptan archivos de imagen (JPG, PNG, GIF).', {
            title: 'Formato inválido', icon: 'image',
        });
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        AppDialog.alert('La imagen supera el límite de 5MB.', {
            title: 'Archivo demasiado grande', icon: 'warning',
        });
        return;
    }

    const formData = new FormData();
    formData.append('foto', file);

    try {
        const resp = await fetch(FOTO_URL, {
            method: 'POST',
            headers: { 'X-CSRFToken': CSRF_TOKEN },
            body: formData,
        });
        const data = await resp.json();
        if (!resp.ok) {
            AppDialog.alert(data.error || 'Error al subir la foto.', {
                title: 'Error', icon: 'error',
            });
            return;
        }
        // Forzar recarga de la imagen evitando caché del navegador
        profilePhoto.src = `${FOTO_URL}?v=${Date.now()}`;
        mostrarNotificacion('Foto de perfil actualizada correctamente.', 'success');
    } catch {
        AppDialog.alert('Error de conexión. Intente nuevamente.', {
            title: 'Sin conexión', icon: 'wifi_off',
        });
    } finally {
        photoInput.value = '';
    }
});

// ═══════════════════════════════════════════════════════════════
//  Foto de perfil — eliminar
// ═══════════════════════════════════════════════════════════════
btnRemove.addEventListener('click', async () => {
    const confirmar = await AppDialog.confirm('¿Está seguro de eliminar su foto de perfil?', {
        title: 'Confirmar eliminación',
        icon: 'delete',
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        variant: 'danger',
    });
    if (!confirmar) return;

    try {
        const resp = await fetch(FOTO_DEL_URL, {
            method: 'POST',
            headers: {
                'X-CSRFToken': CSRF_TOKEN,
                'Content-Type': 'application/json',
            },
        });
        const data = await resp.json();
        if (!resp.ok) {
            AppDialog.alert(data.error || 'Error al eliminar la foto.', {
                title: 'Error', icon: 'error',
            });
            return;
        }
        profilePhoto.src = PLACEHOLDER_URL;
        mostrarNotificacion('Foto de perfil eliminada.', 'info');
    } catch {
        AppDialog.alert('Error de conexión. Intente nuevamente.', {
            title: 'Sin conexión', icon: 'wifi_off',
        });
    }
});

// ═══════════════════════════════════════════════════════════════
//  Drag & drop sobre la foto
// ═══════════════════════════════════════════════════════════════
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
    photoOverlay.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, false);
    document.body.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, false);
});

['dragenter', 'dragover'].forEach(ev => {
    photoOverlay.addEventListener(ev, () => { photoOverlay.style.opacity = '1'; }, false);
});

['dragleave', 'drop'].forEach(ev => {
    photoOverlay.addEventListener(ev, () => { photoOverlay.style.opacity = ''; }, false);
});

photoOverlay.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        photoInput.files = files;
        photoInput.dispatchEvent(new Event('change'));
    }
}, false);

// ═══════════════════════════════════════════════════════════════
//  Expandir / contraer historial de cargos
// ═══════════════════════════════════════════════════════════════
if (btnToggleHistorial) {
    btnToggleHistorial.addEventListener('click', () => {
        historialContainer.classList.toggle('expanded');
        btnToggleHistorial.classList.toggle('active');
        btnToggleHistorial.querySelector('span').textContent =
            historialContainer.classList.contains('expanded') ? 'Ver menos' : 'Ver historial completo';
    });
}

// ═══════════════════════════════════════════════════════════════
//  Expandir / contraer roles
// ═══════════════════════════════════════════════════════════════
if (btnToggleRoles) {
    btnToggleRoles.addEventListener('click', () => {
        rolesContainer.classList.toggle('expanded');
        btnToggleRoles.classList.toggle('active');
        btnToggleRoles.querySelector('span').textContent =
            rolesContainer.classList.contains('expanded') ? 'Ver menos roles' : 'Ver todos los roles';
    });
}

// ═══════════════════════════════════════════════════════════════
//  Utilidad: notificación tipo toast
// ═══════════════════════════════════════════════════════════════
function mostrarNotificacion(mensaje, tipo) {
    const el = document.createElement('div');
    el.style.cssText = [
        'position:fixed', 'top:20px', 'right:20px', 'padding:14px 20px',
        'border-radius:8px', 'box-shadow:0 4px 12px rgba(0,0,0,.2)',
        'display:flex', 'align-items:center', 'gap:10px',
        'font-weight:600', 'z-index:10000', "font-family:'Montserrat',sans-serif",
        `background:${tipo === 'success' ? '#4caf50' : '#2196f3'}`,
        'color:white', 'animation:_notifIn .3s ease-out',
    ].join(';');
    el.innerHTML = `
        <i class="material-symbols-outlined">${tipo === 'success' ? 'check_circle' : 'info'}</i>
        <span>${mensaje}</span>
    `;
    document.body.appendChild(el);
    setTimeout(() => {
        el.style.animation = '_notifOut .3s ease-out';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

const _style = document.createElement('style');
_style.textContent = `
    @keyframes _notifIn  { from { transform:translateX(400px);opacity:0 } to { transform:translateX(0);opacity:1 } }
    @keyframes _notifOut { from { transform:translateX(0);opacity:1 } to { transform:translateX(400px);opacity:0 } }
`;
document.head.appendChild(_style);
