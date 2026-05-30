// Variables globales
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const mainContent = document.getElementById('mainContent');

// Toggle del sidebar
sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    mainContent.classList.toggle('expanded');
});

// Manejo de items del menú
const menuItems = document.querySelectorAll('.menu-item a');
menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
        // No prevenir el default si es un toggle de submenú
        if (!item.classList.contains('submenu-toggle')) {
            // Remover clase active de todos los items
            document.querySelectorAll('.menu-item').forEach(mi => {
                mi.classList.remove('active');
            });
            
            // Agregar clase active al item clickeado
            item.closest('.menu-item').classList.add('active');
            
            // Obtener la página a cargar
            const page = item.getAttribute('data-page');
            // Dejar que el nav del navegador actúe por defecto sobre el href
        }
    });
});

// Manejo de submenús
const submenuToggles = document.querySelectorAll('.submenu-toggle');
submenuToggles.forEach(toggle => {
    toggle.addEventListener('click', (e) => {
        e.preventDefault();
        const parentItem = toggle.closest('.has-submenu');
        parentItem.classList.toggle('open');
    });
});

// Manejo de items del submenú
const submenuItems = document.querySelectorAll('.submenu a');
submenuItems.forEach(item => {
    item.addEventListener('click', (e) => {
        // Remover clase active de todos los items principales
        document.querySelectorAll('.menu-item').forEach(mi => {
            mi.classList.remove('active');
        });
        
        // Agregar clase active al parent del submenú
        const parentMenuItem = item.closest('.has-submenu');
        parentMenuItem.classList.add('active');
        
        // Obtener la página a cargar
        const page = item.getAttribute('data-page');
        // Dejar que el nav del navegador actúe por defecto sobre el href
    });
});

// Botón de cerrar sesión
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
        // Aquí iría la lógica de cierre de sesión
        await AppDialog.alert('Sesion cerrada correctamente', {
            title: 'Sesion finalizada',
            icon: 'check_circle',
            variant: 'success'
        });
        window.location.href = '/loging.html';
    }
});

// Función para cargar páginas (simulada)
function loadPage(pageName) {
    console.log(`Cargando página: ${pageName}`);
    
    // Aquí­ iría la lógica real de carga de páginas
    // Por ejemplo: window.location.href = `${pageName}.html`;
    
    // En móvil, cerrar el sidebar después de seleccionar
    if (window.innerWidth <= 768) {
        sidebar.classList.remove('mobile-open');
        const overlay = document.querySelector('.sidebar-overlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
    }
}

// Manejo responsive del sidebar en móviles
if (window.innerWidth <= 768) {
    // Agregar overlay para cerrar sidebar
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
    
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('mobile-open');
        overlay.classList.toggle('active');
    });
    
    overlay.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
        overlay.classList.remove('active');
    });
}

// Ajustar el estado del sidebar al cambiar el tamaño de la ventana
window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
        sidebar.classList.remove('mobile-open');
        const overlay = document.querySelector('.sidebar-overlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
    }
});

// CAROUSEL FUNCTIONALITY
const carouselTrack = document.getElementById('carouselTrack');
const slides = document.querySelectorAll('.carousel-slide');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const indicators = document.querySelectorAll('.indicator');

let currentSlide = 0;
const totalSlides = slides.length;

// Función para actualizar el carousel
function updateCarousel() {
    const slideWidth = slides[0].clientWidth;
    carouselTrack.style.transform = `translateX(-${currentSlide * slideWidth}px)`;
    
    // Actualizar indicadores
    indicators.forEach((indicator, index) => {
        if (index === currentSlide) {
            indicator.classList.add('active');
        } else {
            indicator.classList.remove('active');
        }
    });
    
    // Actualizar slides activas
    slides.forEach((slide, index) => {
        if (index === currentSlide) {
            slide.classList.add('active');
        } else {
            slide.classList.remove('active');
        }
    });
}

// Botón siguiente
nextBtn.addEventListener('click', () => {
    currentSlide = (currentSlide + 1) % totalSlides;
    updateCarousel();
});

// Botón anterior
prevBtn.addEventListener('click', () => {
    currentSlide = (currentSlide - 1 + totalSlides) % totalSlides;
    updateCarousel();
});

// Click en indicadores
indicators.forEach((indicator, index) => {
    indicator.addEventListener('click', () => {
        currentSlide = index;
        updateCarousel();
    });
});

// Auto-play del carousel
let autoplayInterval = setInterval(() => {
    currentSlide = (currentSlide + 1) % totalSlides;
    updateCarousel();
}, 5000);

// Pausar autoplay al hacer hover
const carouselWrapper = document.querySelector('.carousel-wrapper');
carouselWrapper.addEventListener('mouseenter', () => {
    clearInterval(autoplayInterval);
});

carouselWrapper.addEventListener('mouseleave', () => {
    autoplayInterval = setInterval(() => {
        currentSlide = (currentSlide + 1) % totalSlides;
        updateCarousel();
    }, 5000);
});

// Ajustar carousel al cambiar tamaño de ventana
window.addEventListener('resize', () => {
    updateCarousel();
});

// Animación de entrada al cargar la página
window.addEventListener('load', () => {
    document.body.style.opacity = '0';
    setTimeout(() => {
        document.body.style.transition = 'opacity 0.5s';
        document.body.style.opacity = '1';
    }, 100);
});
