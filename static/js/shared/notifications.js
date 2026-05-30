(() => {
    const DEFAULTS = {
        title: 'Confirmar',
        message: '',
        confirmText: 'Aceptar',
        cancelText: 'Cancelar',
        icon: 'help',
        variant: 'info'
    };

    let overlay;
    let dialog;
    let titleEl;
    let bodyEl;
    let iconEl;
    let cancelBtn;
    let confirmBtn;
    let activeResolver = null;
    let activeRejecter = null;
    let lastFocused = null;
    let queue = Promise.resolve();

    function ensureDialog() {
        if (overlay) return;

        overlay = document.createElement('div');
        overlay.className = 'app-dialog-overlay';
        overlay.setAttribute('aria-hidden', 'true');

        dialog = document.createElement('div');
        dialog.className = 'app-dialog app-dialog--info';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');

        const header = document.createElement('div');
        header.className = 'app-dialog-header';

        iconEl = document.createElement('span');
        iconEl.className = 'app-dialog-icon material-symbols-outlined';
        iconEl.textContent = DEFAULTS.icon;

        titleEl = document.createElement('h3');
        titleEl.className = 'app-dialog-title';
        titleEl.textContent = DEFAULTS.title;

        header.appendChild(iconEl);
        header.appendChild(titleEl);

        bodyEl = document.createElement('div');
        bodyEl.className = 'app-dialog-body';

        const actions = document.createElement('div');
        actions.className = 'app-dialog-actions';

        cancelBtn = document.createElement('button');
        cancelBtn.className = 'app-dialog-btn app-dialog-btn-cancel';
        cancelBtn.type = 'button';
        cancelBtn.textContent = DEFAULTS.cancelText;

        confirmBtn = document.createElement('button');
        confirmBtn.className = 'app-dialog-btn app-dialog-btn-confirm';
        confirmBtn.type = 'button';
        confirmBtn.textContent = DEFAULTS.confirmText;

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);

        dialog.appendChild(header);
        dialog.appendChild(bodyEl);
        dialog.appendChild(actions);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                handleCancel();
            }
        });

        cancelBtn.addEventListener('click', handleCancel);
        confirmBtn.addEventListener('click', handleConfirm);

        document.addEventListener('keydown', (event) => {
            if (!overlay.classList.contains('is-visible')) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                handleCancel();
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                handleConfirm();
            }
        });
    }

    function applyOptions(options, showCancel) {
        const settings = { ...DEFAULTS, ...options };
        titleEl.textContent = settings.title;
        bodyEl.textContent = settings.message;
        confirmBtn.textContent = settings.confirmText;
        cancelBtn.textContent = settings.cancelText;
        iconEl.textContent = settings.icon || DEFAULTS.icon;

        dialog.classList.remove('app-dialog--info', 'app-dialog--danger', 'app-dialog--success');
        dialog.classList.add(`app-dialog--${settings.variant || 'info'}`);

        cancelBtn.style.display = showCancel ? 'inline-flex' : 'none';
    }

    function openDialog(options, showCancel) {
        ensureDialog();
        applyOptions(options, showCancel);

        lastFocused = document.activeElement;
        overlay.classList.add('is-visible');
        overlay.setAttribute('aria-hidden', 'false');

        setTimeout(() => {
            confirmBtn.focus();
        }, 0);
    }

    function closeDialog() {
        overlay.classList.remove('is-visible');
        overlay.setAttribute('aria-hidden', 'true');
        if (lastFocused && lastFocused.focus) {
            lastFocused.focus();
        }
    }

    function handleConfirm() {
        closeDialog();
        if (activeResolver) activeResolver(true);
        cleanupHandlers();
    }

    function handleCancel() {
        closeDialog();
        if (activeResolver) activeResolver(false);
        cleanupHandlers();
    }

    function cleanupHandlers() {
        activeResolver = null;
        activeRejecter = null;
    }

    function enqueue(fn) {
        queue = queue.then(() => new Promise(fn));
        return queue;
    }

    function confirmDialog(message, options = {}) {
        return new Promise((resolve, reject) => {
            enqueue((done) => {
                activeResolver = (value) => {
                    resolve(value);
                    done();
                };
                activeRejecter = reject;
                openDialog({ ...options, message }, true);
            });
        });
    }

    function alertDialog(message, options = {}) {
        return new Promise((resolve, reject) => {
            enqueue((done) => {
                activeResolver = () => {
                    resolve(true);
                    done();
                };
                activeRejecter = reject;
                openDialog({
                    ...options,
                    title: options.title || 'Mensaje',
                    icon: options.icon || 'info',
                    variant: options.variant || 'info',
                    message,
                    cancelText: options.cancelText || DEFAULTS.cancelText
                }, false);
            });
        });
    }

    window.AppDialog = {
        confirm: confirmDialog,
        alert: alertDialog
    };
})();
