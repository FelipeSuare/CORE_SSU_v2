const CSRF = document.querySelector('meta[name="csrf-token"]').content;

// ── Requisitos de contraseña ─────────────────────────────────
const REQUISITOS = [
    { id: 'rq-len',   test: p => p.length >= 8 },
    { id: 'rq-upper', test: p => /[A-Z]/.test(p) },
    { id: 'rq-lower', test: p => /[a-z]/.test(p) },
    { id: 'rq-num',   test: p => /[0-9]/.test(p) },
    { id: 'rq-spec',  test: p => /[@$!%*?&#]/.test(p) },
];

document.getElementById('nuevaContrasena').addEventListener('input', () => {
    const p = document.getElementById('nuevaContrasena').value;
    REQUISITOS.forEach(({ id, test }) =>
        document.getElementById(id).classList.toggle('valid', test(p))
    );
    actualizarMatch();
});

document.getElementById('confirmarContrasena').addEventListener('input', actualizarMatch);

function actualizarMatch() {
    const nueva     = document.getElementById('nuevaContrasena').value;
    const confirmar = document.getElementById('confirmarContrasena').value;
    const msg       = document.getElementById('matchMsg');
    if (!confirmar) { msg.textContent = ''; msg.className = 'match-msg'; return; }
    const ok = nueva === confirmar;
    msg.textContent = ok ? '✓ Las contraseñas coinciden' : '✗ Las contraseñas no coinciden';
    msg.className   = `match-msg ${ok ? 'match-ok' : 'match-err'}`;
}

// ── Navegación entre pasos ────────────────────────────────────
function irPaso(id) {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// ── Mensajes de error inline ──────────────────────────────────
function mostrarError(elId, msg) {
    const el = document.getElementById(elId);
    el.textContent   = msg;
    el.style.display = 'block';
}
function ocultarError(elId) {
    document.getElementById(elId).style.display = 'none';
}

// ── PASO 1: verificar identidad ───────────────────────────────
document.getElementById('formStep1').addEventListener('submit', async e => {
    e.preventDefault();
    ocultarError('errorStep1');

    const btn = document.getElementById('btnVerificar');
    btn.disabled    = true;
    btn.textContent = 'Verificando…';

    try {
        const resp = await fetch('/recuperar/verificar/', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
            body: JSON.stringify({
                ci:               document.getElementById('ci').value.trim(),
                fecha_nacimiento: document.getElementById('fechaNacimiento').value,
                matricula_seguro: document.getElementById('matriculaSeguro').value.trim(),
            }),
        });
        const data = await resp.json();
        if (!resp.ok) {
            mostrarError('errorStep1', data.error || 'Error al verificar.');
        } else {
            irPaso('step2');
        }
    } catch {
        mostrarError('errorStep1', 'Error de conexión. Intente nuevamente.');
    } finally {
        btn.disabled    = false;
        btn.innerHTML   = '<i class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;margin-right:6px">verified_user</i>Verificar';
    }
});

// ── PASO 2: nueva contraseña ──────────────────────────────────
document.getElementById('formStep2').addEventListener('submit', async e => {
    e.preventDefault();
    ocultarError('errorStep2');

    const nueva     = document.getElementById('nuevaContrasena').value.trim();
    const confirmar = document.getElementById('confirmarContrasena').value.trim();
    const patron    = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#]).{8,}$/;

    if (!patron.test(nueva)) {
        mostrarError('errorStep2', 'La contraseña no cumple con los requisitos indicados.');
        return;
    }
    if (nueva !== confirmar) {
        mostrarError('errorStep2', 'Las contraseñas no coinciden.');
        return;
    }

    const btn = document.getElementById('btnGuardar');
    btn.disabled    = true;
    btn.textContent = 'Guardando…';

    try {
        const resp = await fetch('/recuperar/nueva/', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
            body: JSON.stringify({ nueva, confirmar }),
        });
        const data = await resp.json();
        if (!resp.ok) {
            mostrarError('errorStep2', data.error || 'Error al guardar.');
        } else {
            irPaso('stepOk');
            setTimeout(() => { window.location.href = '/'; }, 3000);
        }
    } catch {
        mostrarError('errorStep2', 'Error de conexión. Intente nuevamente.');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = '<i class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;margin-right:6px">save</i>Guardar Contraseña';
    }
});

// ── Toggle visibilidad ────────────────────────────────────────
function toggleVis(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon  = document.getElementById(iconId);
    const oculta = input.type === 'password';
    input.type       = oculta ? 'text'         : 'password';
    icon.textContent = oculta ? 'visibility'   : 'visibility_off';
}
