// ═══════════════════════════════════════════════════════════════
//  Configuración desde meta-tags inyectados por Django
// ═══════════════════════════════════════════════════════════════
const CSRF_TOKEN     = document.querySelector('meta[name="csrf-token"]').content;
const ENDPOINT       = document.querySelector('meta[name="cambio-contrasena-url"]').content;
const REDIRECT_POST  = document.querySelector('meta[name="redirect-post-cambio"]')?.content || null;

// ═══════════════════════════════════════════════════════════════
//  Elementos del DOM
// ═══════════════════════════════════════════════════════════════
const form               = document.getElementById('cambioContrasenaForm');
const contrasenaActual   = document.getElementById('contrasenaActual');
const contrasenaNueva    = document.getElementById('contrasenaNueva');
const contrasenaConfirmar = document.getElementById('contrasenaConfirmar');
const passwordStrength   = document.getElementById('passwordStrength');
const strengthFill       = document.getElementById('strengthFill');
const strengthText       = document.getElementById('strengthText');
const matchIndicator     = document.getElementById('matchIndicator');
const alertSuccess       = document.getElementById('alertSuccess');
const alertError         = document.getElementById('alertError');
const errorMessage       = document.getElementById('errorMessage');
const btnSubmit          = form.querySelector('button[type="submit"]');

// ═══════════════════════════════════════════════════════════════
//  Eventos
// ═══════════════════════════════════════════════════════════════
contrasenaNueva.addEventListener('input', () => {
    validarFortaleza();
    validarRequisitos();
    validarCoincidencia();
});

contrasenaConfirmar.addEventListener('input', validarCoincidencia);

form.addEventListener('submit', (e) => {
    e.preventDefault();
    cambiarContrasena();
});

// ═══════════════════════════════════════════════════════════════
//  Toggle visibilidad de contraseña
// ═══════════════════════════════════════════════════════════════
function togglePassword(inputId) {
    const input = document.getElementById(inputId);
    const icon  = document.getElementById(`icon-${inputId}`);
    const oculta = input.type === 'password';
    input.type        = oculta ? 'text' : 'password';
    icon.textContent  = oculta ? 'visibility_off' : 'visibility';
}

// ═══════════════════════════════════════════════════════════════
//  Indicador de fortaleza
// ═══════════════════════════════════════════════════════════════
function validarFortaleza() {
    const p = contrasenaNueva.value;

    if (!p) {
        passwordStrength.style.display = 'none';
        return;
    }
    passwordStrength.style.display = 'block';

    let puntos = 0;
    if (p.length >= 8)        puntos++;
    if (p.length >= 12)       puntos++;
    if (/[a-z]/.test(p))      puntos++;
    if (/[A-Z]/.test(p))      puntos++;
    if (/[0-9]/.test(p))      puntos++;
    if (/[@$!%*?&#]/.test(p)) puntos++;

    passwordStrength.classList.remove('strength-weak', 'strength-medium', 'strength-strong');

    if (puntos <= 2) {
        passwordStrength.classList.add('strength-weak');
        strengthText.textContent = 'Débil';
    } else if (puntos <= 4) {
        passwordStrength.classList.add('strength-medium');
        strengthText.textContent = 'Media';
    } else {
        passwordStrength.classList.add('strength-strong');
        strengthText.textContent = 'Fuerte';
    }
}

// ═══════════════════════════════════════════════════════════════
//  Requisitos dinámicos
// ═══════════════════════════════════════════════════════════════
const REQUISITOS = [
    { id: 'req-length',    test: p => p.length >= 8 },
    { id: 'req-uppercase', test: p => /[A-Z]/.test(p) },
    { id: 'req-lowercase', test: p => /[a-z]/.test(p) },
    { id: 'req-number',    test: p => /[0-9]/.test(p) },
    { id: 'req-special',   test: p => /[@$!%*?&#]/.test(p) },
];

function validarRequisitos() {
    const p = contrasenaNueva.value;
    REQUISITOS.forEach(({ id, test }) => {
        document.getElementById(id).classList.toggle('valid', test(p));
    });
}

// ═══════════════════════════════════════════════════════════════
//  Indicador de coincidencia
// ═══════════════════════════════════════════════════════════════
function validarCoincidencia() {
    const nueva     = contrasenaNueva.value;
    const confirmar = contrasenaConfirmar.value;

    if (!confirmar) {
        matchIndicator.textContent = '';
        matchIndicator.className   = 'match-indicator';
        return;
    }

    const coincide = nueva === confirmar;
    matchIndicator.textContent = coincide
        ? '✓ Las contraseñas coinciden'
        : '✗ Las contraseñas no coinciden';
    matchIndicator.className = `match-indicator ${coincide ? 'match' : 'no-match'}`;
}

// ═══════════════════════════════════════════════════════════════
//  Validación frontend completa (antes de enviar al servidor)
// ═══════════════════════════════════════════════════════════════
function validarFormulario() {
    const actual    = contrasenaActual.value.trim();
    const nueva     = contrasenaNueva.value.trim();
    const confirmar = contrasenaConfirmar.value.trim();

    if (!actual || !nueva || !confirmar) {
        mostrarError('Por favor, completa todos los campos.');
        return false;
    }
    if (nueva.length < 8)            { mostrarError('La nueva contraseña debe tener al menos 8 caracteres.'); return false; }
    if (!/[A-Z]/.test(nueva))        { mostrarError('La nueva contraseña debe contener al menos una letra mayúscula.'); return false; }
    if (!/[a-z]/.test(nueva))        { mostrarError('La nueva contraseña debe contener al menos una letra minúscula.'); return false; }
    if (!/[0-9]/.test(nueva))        { mostrarError('La nueva contraseña debe contener al menos un número.'); return false; }
    if (!/[@$!%*?&#]/.test(nueva))   { mostrarError('La nueva contraseña debe contener al menos un carácter especial (@$!%*?&#).'); return false; }
    if (nueva !== confirmar)         { mostrarError('La confirmación de contraseña no coincide con la nueva contraseña.'); return false; }

    return true;
}

// ═══════════════════════════════════════════════════════════════
//  Envío al backend
// ═══════════════════════════════════════════════════════════════
async function cambiarContrasena() {
    ocultarAlertas();
    if (!validarFormulario()) return;

    btnSubmit.disabled    = true;
    btnSubmit.textContent = 'Procesando…';

    try {
        const resp = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': CSRF_TOKEN,
            },
            body: JSON.stringify({
                actual:    contrasenaActual.value.trim(),
                nueva:     contrasenaNueva.value.trim(),
                confirmar: contrasenaConfirmar.value.trim(),
            }),
        });

        const data = await resp.json();

        if (!resp.ok) {
            mostrarError(data.error || 'Error al cambiar la contraseña.');
            return;
        }

        // Éxito
        if (REDIRECT_POST) {
            await AppDialog.alert('Contraseña actualizada correctamente. Serás redirigido al sistema.', {
                title: 'Éxito', icon: 'check_circle', variant: 'success',
            });
            window.location.href = REDIRECT_POST;
            return;
        }
        limpiarFormulario();
        mostrarExito('¡Contraseña actualizada exitosamente!');

    } catch {
        AppDialog.alert('Error de conexión. Intente nuevamente.', {
            title: 'Error de conexión', icon: 'wifi_off',
        });
    } finally {
        btnSubmit.disabled    = false;
        btnSubmit.innerHTML   = '<i class="material-symbols-outlined">save</i> Cambiar Contraseña';
    }
}

// ═══════════════════════════════════════════════════════════════
//  Cancelar
// ═══════════════════════════════════════════════════════════════
async function cancelar() {
    const hayCambios = contrasenaActual.value || contrasenaNueva.value || contrasenaConfirmar.value;

    if (hayCambios) {
        const confirmar = await AppDialog.confirm(
            '¿Estás seguro de que deseas cancelar? Se perderán los datos ingresados.',
            {
                title: 'Confirmar cancelación',
                icon: 'help',
                confirmText: 'Sí, cancelar',
                cancelText: 'Volver',
                variant: 'danger',
            }
        );
        if (!confirmar) return;
    }

    limpiarFormulario();
}

// ═══════════════════════════════════════════════════════════════
//  Utilidades
// ═══════════════════════════════════════════════════════════════
function mostrarError(mensaje) {
    errorMessage.textContent    = mensaje;
    alertError.style.display    = 'flex';
    alertSuccess.style.display  = 'none';
}

function mostrarExito(mensaje) {
    alertSuccess.querySelector('span').textContent = mensaje;
    alertSuccess.style.display = 'flex';
    alertError.style.display   = 'none';
}

function ocultarAlertas() {
    alertSuccess.style.display = 'none';
    alertError.style.display   = 'none';
}

function limpiarFormulario() {
    form.reset();
    passwordStrength.style.display = 'none';
    matchIndicator.textContent     = '';
    matchIndicator.className       = 'match-indicator';
    document.querySelectorAll('.requirements-list li').forEach(li => li.classList.remove('valid'));
    ocultarAlertas();
}
