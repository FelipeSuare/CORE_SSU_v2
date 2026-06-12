// ── Sidebar elements ─────────────────────────────────────────────
const sidebar       = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const mainContent   = document.getElementById('mainContent');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');

// Overlay (created once, always in DOM)
const overlay = document.createElement('div');
overlay.className = 'sidebar-overlay';
document.body.appendChild(overlay);

// ── Helpers ──────────────────────────────────────────────────────
function isMobile() {
    return window.innerWidth <= 768;
}

function openMobile() {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('active');
    if (mobileMenuBtn) {
        mobileMenuBtn.querySelector('.material-symbols-outlined').textContent = 'close';
    }
}

function closeMobile() {
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('active');
    if (mobileMenuBtn) {
        mobileMenuBtn.querySelector('.material-symbols-outlined').textContent = 'menu';
    }
}

// ── Sidebar toggle ───────────────────────────────────────────────
// Desktop: colapsa/expande. Móvil: solo cierra (el botón está dentro del sidebar visible).
sidebarToggle.addEventListener('click', () => {
    if (isMobile()) {
        closeMobile();
    } else {
        sidebar.classList.toggle('collapsed');
        mainContent.classList.toggle('expanded');
    }
});

// Botón hamburguesa del topbar móvil
if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.contains('mobile-open') ? closeMobile() : openMobile();
    });
}

// Click en overlay cierra el sidebar
overlay.addEventListener('click', closeMobile);

// ── Ítems del menú ───────────────────────────────────────────────
const menuItems = document.querySelectorAll('.menu-item a');
menuItems.forEach(item => {
    item.addEventListener('click', () => {
        if (!item.classList.contains('submenu-toggle')) {
            document.querySelectorAll('.menu-item').forEach(mi => mi.classList.remove('active'));
            item.closest('.menu-item').classList.add('active');
            if (isMobile()) closeMobile();
        }
    });
});

// ── Submenús ─────────────────────────────────────────────────────
const submenuToggles = document.querySelectorAll('.submenu-toggle');
submenuToggles.forEach(toggle => {
    toggle.addEventListener('click', (e) => {
        e.preventDefault();
        toggle.closest('.has-submenu').classList.toggle('open');
    });
});

const submenuItems = document.querySelectorAll('.submenu a');
submenuItems.forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.menu-item').forEach(mi => mi.classList.remove('active'));
        item.closest('.has-submenu').classList.add('active');
        if (isMobile()) closeMobile();
    });
});

// ── Cerrar sesión ─────────────────────────────────────────────────
const btnLogout = document.querySelector('.btn-logout');
btnLogout.addEventListener('click', async () => {
    const confirmar = await AppDialog.confirm('¿Estás seguro que deseas cerrar sesión?', {
        title: 'Confirmar cierre de sesion',
        icon: 'logout',
        confirmText: 'Cerrar sesion',
        cancelText: 'Cancelar',
        variant: 'danger'
    });

    if (confirmar) {
        await AppDialog.alert('Sesion cerrada correctamente', {
            title: 'Sesion finalizada',
            icon: 'check_circle',
            variant: 'success'
        });
        window.location.href = '/loging.html';
    }
});

// ── Resize ────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
    if (!isMobile()) {
        closeMobile();
    }
    updateCarousel();
});

// ── CAROUSEL ──────────────────────────────────────────────────────
const carouselTrack = document.getElementById('carouselTrack');
const slides        = document.querySelectorAll('.carousel-slide');
const prevBtn       = document.getElementById('prevBtn');
const nextBtn       = document.getElementById('nextBtn');
const indicators    = document.querySelectorAll('.indicator');

let currentSlide = 0;
const totalSlides = slides.length;

function updateCarousel() {
    const slideWidth = slides[0].clientWidth;
    carouselTrack.style.transform = `translateX(-${currentSlide * slideWidth}px)`;

    indicators.forEach((indicator, index) => {
        indicator.classList.toggle('active', index === currentSlide);
    });

    slides.forEach((slide, index) => {
        slide.classList.toggle('active', index === currentSlide);
    });
}

nextBtn.addEventListener('click', () => {
    currentSlide = (currentSlide + 1) % totalSlides;
    updateCarousel();
});

prevBtn.addEventListener('click', () => {
    currentSlide = (currentSlide - 1 + totalSlides) % totalSlides;
    updateCarousel();
});

indicators.forEach((indicator, index) => {
    indicator.addEventListener('click', () => {
        currentSlide = index;
        updateCarousel();
    });
});

let autoplayInterval = setInterval(() => {
    currentSlide = (currentSlide + 1) % totalSlides;
    updateCarousel();
}, 5000);

const carouselWrapper = document.querySelector('.carousel-wrapper');
carouselWrapper.addEventListener('mouseenter', () => clearInterval(autoplayInterval));
carouselWrapper.addEventListener('mouseleave', () => {
    autoplayInterval = setInterval(() => {
        currentSlide = (currentSlide + 1) % totalSlides;
        updateCarousel();
    }, 5000);
});
