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

    // html2pdf se ejecuta DENTRO del iframe: si corre en la página, clona el
    // body a la página actual y se pierde el <style> del PDF (se aplica el CSS
    // de la página en su lugar).
    const h2pSrc = document.querySelector('script[src*="html2pdf"]').src;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left     = '-10000px';
    iframe.style.top      = '0';
    iframe.style.width    = '1200px';
    iframe.style.height   = '800px';
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
                const pdf = await iframe.contentWindow.html2pdf().from(doc.body).set({
                    // Array del iframe: html2pdf valida con instanceof Array.
                    margin: iframe.contentWindow.Array.of(42, 0, 56, 0),
                    html2canvas: { scale: 2, useCORS: true },
                    jsPDF: { unit: 'pt', format: 'a4', orientation },
                }).toPdf().get('pdf');
                if (typeof PDF_THEME !== 'undefined' && PDF_THEME.pieDePagina) PDF_THEME.pieDePagina(pdf);

                // Descarga desde la página (no con .save() del iframe: difiere
                // el click y el iframe ya se eliminó en `finally`).
                const url = URL.createObjectURL(pdf.output('blob'));
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 60000);
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
        `<head><base href="${window.location.origin}/"><script src="${h2pSrc}"><\/script>`
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
