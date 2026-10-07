// Descarga un PDF directamente (sin abrir pestaña ni diálogo de impresión) a
// partir de un documento HTML completo, usando html2pdf.js sobre un iframe
// oculto para no filtrar los estilos del PDF a la página actual.
//
// Único punto de verdad: lo usan Reporte Personal e Historial de Cargos.
function descargarPDFDesdeHTML(htmlCompleto, filename, orientation = 'landscape') {
    if (typeof html2pdf === 'undefined') {
        alert('No se pudo cargar el generador de PDF (posible bloqueo de red, firewall o extensión del navegador). Verifique su conexión e intente de nuevo.');
        return;
    }

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right    = '0';
    iframe.style.bottom   = '0';
    iframe.style.width    = '0';
    iframe.style.height   = '0';
    iframe.style.border   = '0';
    document.body.appendChild(iframe);

    const limpiar = () => {
        if (iframe.parentNode) document.body.removeChild(iframe);
    };

    iframe.onload = () => {
        (async () => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow.document;

                if (doc.fonts && doc.fonts.ready) {
                    await doc.fonts.ready;
                }

                const imagenes = Array.from(doc.images || []).map(img => {
                    if (img.complete) return Promise.resolve();
                    return new Promise(resolve => {
                        img.onload = resolve;
                        img.onerror = resolve;
                    });
                });

                if (imagenes.length > 0) {
                    await Promise.all(imagenes);
                }

                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

                // Márgenes verticales en pt: superior en cada página y espacio
                // inferior para el pie (PDF_THEME.pieDePagina).
                await html2pdf().from(doc.body).set({
                    margin: [42, 0, 56, 0],
                    filename,
                    html2canvas: { scale: 2, useCORS: true },
                    jsPDF: { unit: 'pt', format: 'a4', orientation },
                }).toPdf().get('pdf').then(pdf => {
                    if (typeof PDF_THEME !== 'undefined' && PDF_THEME.pieDePagina) PDF_THEME.pieDePagina(pdf);
                }).save();
            } catch (err) {
                console.error('Error generando PDF:', err);
                alert('No se pudo generar el PDF. Intente nuevamente.');
            } finally {
                limpiar();
            }
        })();
    };

    const htmlConBase = htmlCompleto.replace(
        '<head>',
        `<head><base href="${window.location.origin}/">`
    );

    iframe.srcdoc = htmlConBase;
}

// Limpia un nombre para usarlo como nombre de archivo (conserva espacios).
function nombreArchivoSeguro(str) {
    return String(str || 'documento')
        .replace(/[\/:*?"<>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
