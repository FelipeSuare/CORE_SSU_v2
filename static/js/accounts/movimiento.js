document.addEventListener("DOMContentLoaded", () => {

    // Animación de aparición del contenedor
    const container = document.querySelector(".container");
    if (container) {
        container.style.opacity = "0";
        container.style.transform = "scale(0.9)";

        setTimeout(() => {
            container.style.transition = "0.8s ease";
            container.style.opacity = "1";
            container.style.transform = "scale(1)";
        }, 100);
    }

    // Animación de entrada del panel izquierdo
    const leftPanel = document.querySelector(".left-panel");
    if (leftPanel) {
        leftPanel.style.opacity = "0";
        leftPanel.style.transform = "translateX(-40px)";

        setTimeout(() => {
            leftPanel.style.transition = "0.8s ease";
            leftPanel.style.opacity = "1";
            leftPanel.style.transform = "translateX(0)";
        }, 250);
    }

    // Animación de entrada del panel derecho
    const rightPanel = document.querySelector(".right-panel");
    if (rightPanel) {
        rightPanel.style.opacity = "0";
        rightPanel.style.transform = "translateX(40px)";

        setTimeout(() => {
            rightPanel.style.transition = "0.8s ease";
            rightPanel.style.opacity = "1";
            rightPanel.style.transform = "translateX(0)";
        }, 400);
    }

    // Animación suave al escribir en inputs
    const inputs = document.querySelectorAll(".input-group input");

    inputs.forEach(input => {
        input.addEventListener("focus", () => {
            input.parentElement.style.transform = "scale(1.03)";
            input.parentElement.style.transition = "0.2s";
        });

        input.addEventListener("blur", () => {
            input.parentElement.style.transform = "scale(1)";
        });
    });

    // Animación del botón
    const btn = document.querySelector("button");
    if (btn) {
        btn.addEventListener("mouseenter", () => {
            btn.style.transform = "scale(1.05)";
            btn.style.transition = "0.2s";
        });

        btn.addEventListener("mouseleave", () => {
            btn.style.transform = "scale(1)";
        });
    }
});
