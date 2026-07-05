document.addEventListener('DOMContentLoaded', () => {

    // ══════════════════════════════════════════════
    // ESTADO DEL MÓDULO
    // ══════════════════════════════════════════════
    let todosFuncionarios  = [];
    let datosFiltrados     = [];
    let areaLabel          = 'RECURSOS HUMANOS';
    let nombreRRHH         = '';
    let modoUnico          = false;
    let gestionUnica       = null;     // integer o null
    let GESTIONES          = [];       // [2023, 2024, 2025, 2026]
    let filtroContrato     = '';
    let filtroUnidad       = '';
    let filtroUnidadNombre = '';
    let puedeVerDiasPerdidos = false;

    const toggleChk      = document.getElementById('toggleGestionUnica');
    const grupoUnico     = document.getElementById('grupoGestionUnica');
    const inputAnioUnico = document.getElementById('anioUnico');
    const thColspan      = document.getElementById('thGrupoLabel');

    // ══════════════════════════════════════════════
    // INICIALIZACIÓN
    // ══════════════════════════════════════════════
    async function init() {
        await cargarPerfil();
        await cargarUnidades();
        await cargarFuncionarios();
    }

    // ══════════════════════════════════════════════
    // PROFILE SWITCHER
    // ══════════════════════════════════════════════
    async function cargarPerfil() {
        try {
            const resp = await fetch('/api/usuario/mi-perfil/');
            const data = await resp.json();
            if (!data.error) {
                window.initProfileSwitcher?.({ roles: data.roles, nombre: data.nombre_completo });
                window.setupProfileToggle?.();
            }
        } catch (e) {
            console.error('Error cargando perfil:', e);
        }
    }

    // ══════════════════════════════════════════════
    // CARGA DE UNIDADES
    // ══════════════════════════════════════════════
    async function cargarUnidades() {
        try {
            const res  = await fetch('/api/reportes/personal/unidades/');
            const data = await res.json();
            if (data.error) return;

            areaLabel  = data.area_label  || 'RECURSOS HUMANOS';
            nombreRRHH = data.nombre_rrhh || '';

            const sel = document.getElementById('unidadOrg');
            data.unidades.forEach(u => {
                const opt = document.createElement('option');
                opt.value       = u.id_unidad;
                opt.textContent = u.nombre;
                sel.appendChild(opt);
            });
        } catch (e) {
            console.error('Error cargando unidades:', e);
        }
    }

    // ══════════════════════════════════════════════
    // CARGA DE FUNCIONARIOS DESDE API
    // ══════════════════════════════════════════════
    async function cargarFuncionarios(params = {}) {
        const tbody = document.getElementById('tablaBody');
        const cols  = (modoUnico ? 8 : 10) + (puedeVerDiasPerdidos ? 1 : 0);
        tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center;padding:32px;color:#aaa">
            <i class="material-symbols-outlined" style="vertical-align:middle">hourglass_empty</i> Cargando…
        </td></tr>`;

        const qs = new URLSearchParams(params).toString();
        try {
            const res  = await fetch(`/api/reportes/personal/funcionarios/${qs ? '?' + qs : ''}`);
            const data = await res.json();
            if (data.error) {
                tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center;padding:28px;color:#c00">${data.error}</td></tr>`;
                return;
            }
            todosFuncionarios = data.funcionarios;
            datosFiltrados    = [...todosFuncionarios];
            puedeVerDiasPerdidos = !!data.puede_ver_dias_perdidos;
            document.getElementById('thDiasPerdidos').style.display = puedeVerDiasPerdidos ? '' : 'none';

            // Determinar años de gestión desde los datos reales
            GESTIONES = determinarAniosGestiones(todosFuncionarios);
            actualizarCabeceras();
            renderTabla(datosFiltrados);
        } catch (e) {
            console.error('Error cargando funcionarios:', e);
        }
    }

    // ══════════════════════════════════════════════
    // DETERMINAR AÑOS DE GESTIÓN
    // ══════════════════════════════════════════════
    function determinarAniosGestiones(_funcionarios) {
        const base = new Date().getFullYear();
        return [base, base - 1, base - 2];
    }

    function actualizarCabeceras() {
        ['thG1','thG2','thG3'].forEach((id, i) => {
            const th = document.getElementById(id);
            th.textContent   = GESTIONES[i];
            th.style.display = '';
        });
        thColspan.setAttribute('colspan', '3');
    }

    // ══════════════════════════════════════════════
    // RENDERIZAR TABLA
    // ══════════════════════════════════════════════
    function renderTabla(datos) {
        const tbody = document.getElementById('tablaBody');
        tbody.innerHTML = '';

        document.getElementById('totalFuncionarios').textContent =
            `${datos.length} funcionario${datos.length !== 1 ? 's' : ''}`;

        const gestActivas = (modoUnico && gestionUnica !== null) ? [gestionUnica] : GESTIONES;
        const numCols     = 6 + gestActivas.length + 1 + (puedeVerDiasPerdidos ? 1 : 0);

        if (datos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${numCols}" style="text-align:center;padding:32px;color:#aaa">
                No se encontraron funcionarios con los criterios seleccionados.
            </td></tr>`;
            return;
        }

        datos.forEach((f, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="td-num">${idx + 1}</td>
                <td>${esc(f.apellidos_nombres)}</td>
                <td>${esc(f.cargo)}</td>
                <td>${f.fecha_ingreso}</td>
                <td><span class="badge-contrato">${esc(f.tipo_contrato)}</span></td>
                <td><span class="badge-area">${esc(f.unidad)}</span></td>
                ${gestActivas.map(anio => celdaG(f, anio)).join('')}
                <td><span class="dias-total">${fmt(calcTotalDias(f))}</span></td>
                ${puedeVerDiasPerdidos ? `<td><span class="dias-total">${fmt(f.dias_perdidos || 0)}</span></td>` : ''}
            `;
            tbody.appendChild(tr);
        });
    }

    function celdaG(f, anio) {
        const g    = f.gestiones.find(g => g.anio === anio);
        const dias = g ? g.dias : 0;
        if (dias > 0) return `<td><span class="dias-val">${fmt(dias)}</span></td>`;
        return `<td><span class="sin-dias">—</span></td>`;
    }

    function calcTotalDias(f) {
        if (modoUnico && gestionUnica !== null) {
            const g = f.gestiones.find(g => g.anio === gestionUnica);
            return g ? g.dias : 0;
        }
        return f.dias_adeudados;
    }

    // ══════════════════════════════════════════════
    // MODO GESTIÓN ÚNICA — TOGGLE
    // ══════════════════════════════════════════════
    toggleChk.addEventListener('change', () => {
        modoUnico = toggleChk.checked;
        grupoUnico.style.display = modoUnico ? '' : 'none';

        if (!modoUnico) {
            gestionUnica = null;
            inputAnioUnico.value = '';
            actualizarCabeceras();
            renderTabla(datosFiltrados);
        } else {
            const val = parseInt(inputAnioUnico.value);
            if (val >= 2000 && val <= 2099) {
                gestionUnica = val;
                aplicarModoUnico();
            }
        }
    });

    document.getElementById('btnAnioUnico').addEventListener('click', () => {
        const val = parseInt(inputAnioUnico.value);
        if (!val || val < 2000 || val > 2099) {
            inputAnioUnico.style.borderColor = 'red';
            setTimeout(() => (inputAnioUnico.style.borderColor = ''), 1500);
            return;
        }
        gestionUnica = val;
        aplicarModoUnico();
    });

    inputAnioUnico.addEventListener('keypress', e => {
        if (e.key === 'Enter') document.getElementById('btnAnioUnico').click();
    });

    function aplicarModoUnico() {
        thColspan.setAttribute('colspan', '1');
        document.getElementById('thG1').textContent = gestionUnica;
        ['thG2','thG3'].forEach(id => (document.getElementById(id).style.display = 'none'));
        renderTabla(datosFiltrados);
    }

    // ══════════════════════════════════════════════
    // FILTROS
    // ══════════════════════════════════════════════
    function aplicarFiltros() {
        filtroContrato     = document.getElementById('tipoContrato').value;
        filtroUnidad       = document.getElementById('unidadOrg').value;
        const selU         = document.getElementById('unidadOrg');
        filtroUnidadNombre = filtroUnidad
            ? selU.options[selU.selectedIndex].text
            : '';

        const params = {};
        if (filtroContrato) params.tipo_contrato = filtroContrato;
        if (filtroUnidad)   params.unidad        = filtroUnidad;

        cargarFuncionarios(params);
    }

    document.getElementById('btnBuscar').addEventListener('click', aplicarFiltros);

    document.getElementById('btnLimpiar').addEventListener('click', () => {
        document.getElementById('tipoContrato').value = '';
        document.getElementById('unidadOrg').value    = '';
        filtroContrato     = '';
        filtroUnidad       = '';
        filtroUnidadNombre = '';

        // Resetear modo único
        modoUnico    = false;
        gestionUnica = null;
        toggleChk.checked    = false;
        grupoUnico.style.display = 'none';
        inputAnioUnico.value = '';

        cargarFuncionarios();
    });

    // ══════════════════════════════════════════════
    // EXPORTAR PDF GENERAL
    // ══════════════════════════════════════════════
    document.getElementById('btnExportarPDF').addEventListener('click', () => {
        if (datosFiltrados.length === 0) return;
        generarPDFGeneral(datosFiltrados);
    });

    async function generarPDFGeneral(datos) {
        const hoy      = new Date();
        const fechaStr = `Trinidad, ${hoy.getDate()} de ${nombreMes(hoy.getMonth())} de ${hoy.getFullYear()}`;

        const gestActivas = (modoUnico && gestionUnica !== null) ? [gestionUnica] : GESTIONES;

        // Cabeceras gestión (1 o 2 filas)
        const esMultiple = gestActivas.length > 1;
        const thsGestRow1 = esMultiple
            ? `<th colspan="${gestActivas.length}" style="border-bottom:1px solid rgba(255,255,255,.2);font-size:8px;letter-spacing:.4px">DÍAS PENDIENTES POR GESTIÓN</th>`
            : `<th rowspan="2">GESTIÓN<br>${gestionUnica}</th>`;
        const thsGestRow2 = esMultiple
            ? gestActivas.map(g => `<th>GESTIÓN<br>${g}</th>`).join('')
            : '';

        // Filtros activos para el encabezado del PDF
        const filtrosPartes = [];
        if (filtroContrato)     filtrosPartes.push(`Tipo Contrato: ${filtroContrato}`);
        if (filtroUnidadNombre) filtrosPartes.push(`Área: ${filtroUnidadNombre}`);
        if (modoUnico && gestionUnica !== null) filtrosPartes.push(`Gestión: ${gestionUnica}`);
        const filtrosLabel = filtrosPartes.join(' — ');
        const jsPDFCtor = window.jspdf?.jsPDF || window.jsPDF;
        if (!jsPDFCtor) {
            alert('No se pudo generar el PDF porque no está disponible el motor de exportación.');
            return;
        }

        try {
            const doc = new jsPDFCtor({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const marginX = 10;
            const contentWidth = pageWidth - (marginX * 2);
            const logoData = await cargarImagenBase64('/static/img/login/LOGOSSU.png');

            const fixedWidths = {
                num: 11,
                nombre: 38,
                cargo: 41,
                fecha: 21,
                contrato: 21,
                unidad: 24,
                total: 16,
                perdidos: puedeVerDiasPerdidos ? 16 : 0,
            };
            const fixedSum = fixedWidths.num + fixedWidths.nombre + fixedWidths.cargo + fixedWidths.fecha + fixedWidths.contrato + fixedWidths.unidad + fixedWidths.total + fixedWidths.perdidos;
            const gestWidth = gestActivas.length > 0 ? (contentWidth - fixedSum) / gestActivas.length : 0;
            const firstHeaderY = 54;
            const firstTopHeaderH = gestActivas.length > 1 ? 12 : 24;
            const firstSubHeaderH = gestActivas.length > 1 ? 12 : 0;
            const firstRowY = firstHeaderY + firstTopHeaderH + firstSubHeaderH;
            const repeatRowY = 10;

            const rows = datos.map((f, idx) => ({
                idx: idx + 1,
                nombre: f.apellidos_nombres,
                cargo: f.cargo,
                fecha: f.fecha_ingreso,
                contrato: f.tipo_contrato,
                unidad: f.unidad,
                gestiones: gestActivas.map(anio => {
                    const g = f.gestiones.find(item => item.anio === anio);
                    return g ? g.dias : 0;
                }),
                total: calcTotalDias(f),
                perdidos: puedeVerDiasPerdidos ? (f.dias_perdidos || 0) : null,
            }));

            const drawDocumentHeader = () => {
                doc.addImage(logoData, 'PNG', marginX, 10, 16, 16);
                doc.setTextColor(31, 36, 101);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(14);
                doc.text('SEGURO SOCIAL UNIVERSITARIO', 28, 16);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(130, 130, 138);
                doc.setFontSize(9.5);
                doc.text(areaLabel, 28, 22);
                doc.setTextColor(126, 126, 132);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.text(fechaStr, pageWidth - marginX, 14, { align: 'right' });
                doc.setDrawColor(31, 36, 101);
                doc.setLineWidth(0.8);
                doc.line(marginX, 30, pageWidth - marginX, 30);

                doc.setTextColor(161, 24, 75);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(18);
                doc.text('REPORTE GENERAL', pageWidth / 2, 42, { align: 'center' });

                doc.setTextColor(31, 36, 101);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10.5);
                doc.text(`Total funcionarios: ${datos.length}`, marginX, 48);
                if (filtrosLabel) {
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(114, 0, 53);
                    doc.setFontSize(9.5);
                    doc.text(filtrosLabel, marginX + 52, 48);
                }
            };

            const drawTableHeader = (headerY, headerTopH, headerSubH) => {
                let x = marginX;
                const topHeaderFill = [217, 215, 234];
                const border = [206, 210, 225];

                const baseHeaders = [
                    { key: 'num', label: 'Nº', width: fixedWidths.num },
                    { key: 'nombre', label: 'APELLIDOS Y\nNOMBRES', width: fixedWidths.nombre },
                    { key: 'cargo', label: 'CARGO', width: fixedWidths.cargo },
                    { key: 'fecha', label: 'FECHA\nINGRESO', width: fixedWidths.fecha },
                    { key: 'contrato', label: 'CONTRATO', width: fixedWidths.contrato },
                    { key: 'unidad', label: 'UNIDAD\nORG.', width: fixedWidths.unidad },
                ];

                baseHeaders.forEach(col => {
                    doc.setFillColor(...topHeaderFill);
                    doc.setDrawColor(...border);
                    doc.setLineWidth(0.2);
                    doc.rect(x, headerY, col.width, headerTopH + headerSubH, 'FD');
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(8.2);
                    doc.setTextColor(43, 47, 109);
                    doc.text(col.label.split('\n'), x + col.width / 2, headerY + ((headerTopH + headerSubH) / 2), {
                        align: 'center',
                        baseline: 'middle',
                    });
                    x += col.width;
                });

                const gestWidthTotal = gestWidth * gestActivas.length;
                doc.setFillColor(...topHeaderFill);
                doc.setDrawColor(...border);
                doc.setLineWidth(0.2);
                doc.rect(x, headerY, gestWidthTotal, headerTopH, 'FD');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8.4);
                doc.setTextColor(43, 47, 109);
                if (gestActivas.length > 1) {
                    doc.text('DÍAS PENDIENTES POR\nGESTIÓN', x + gestWidthTotal / 2, headerY + (headerTopH / 2), { align: 'center', baseline: 'middle' });
                    let gx = x;
                    gestActivas.forEach(anio => {
                        doc.setFillColor(...topHeaderFill);
                        doc.setDrawColor(...border);
                        doc.rect(gx, headerY + headerTopH, gestWidth, headerSubH, 'FD');
                        doc.setFontSize(8.2);
                        doc.text(`GESTIÓN\n${anio}`.split('\n'), gx + gestWidth / 2, headerY + headerTopH + (headerSubH / 2), {
                            align: 'center',
                            baseline: 'middle',
                        });
                        gx += gestWidth;
                    });
                } else {
                    doc.text(`GESTIÓN\n${gestActivas[0]}`.split('\n'), x + gestWidthTotal / 2, headerY + (headerTopH / 2), {
                        align: 'center',
                        baseline: 'middle',
                    });
                }
                x += gestWidthTotal;

                doc.setFillColor(...topHeaderFill);
                doc.setDrawColor(...border);
                doc.rect(x, headerY, fixedWidths.total, headerTopH + headerSubH, 'FD');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8.2);
                doc.text('TOTAL\nDÍAS'.split('\n'), x + fixedWidths.total / 2, headerY + ((headerTopH + headerSubH) / 2), {
                    align: 'center',
                    baseline: 'middle',
                });
                x += fixedWidths.total;

                if (puedeVerDiasPerdidos) {
                    doc.setFillColor(...topHeaderFill);
                    doc.setDrawColor(...border);
                    doc.rect(x, headerY, fixedWidths.perdidos, headerTopH + headerSubH, 'FD');
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(8.2);
                    doc.text('DÍAS\nPERDIDOS'.split('\n'), x + fixedWidths.perdidos / 2, headerY + ((headerTopH + headerSubH) / 2), {
                        align: 'center',
                        baseline: 'middle',
                    });
                }
            };

            const drawRow = (row, y, index, rowStartY) => {
                const fill = index % 2 === 0 ? [255, 255, 255] : [252, 247, 249];
                const border = [228, 229, 237];

                const cellData = [
                    { width: fixedWidths.num, text: String(row.idx), align: 'center', color: [153, 153, 153], bold: false, fontSize: 8.4 },
                    { width: fixedWidths.nombre, text: row.nombre, align: 'left', color: [27, 37, 89], bold: true, fontSize: 8.2 },
                    { width: fixedWidths.cargo, text: row.cargo, align: 'center', color: [55, 59, 94], bold: false, fontSize: 7.9 },
                    { width: fixedWidths.fecha, text: row.fecha, align: 'center', color: [55, 59, 94], bold: false, fontSize: 8.4 },
                    { width: fixedWidths.contrato, text: row.contrato, align: 'center', color: [55, 59, 94], bold: false, fontSize: 7.8 },
                    { width: fixedWidths.unidad, text: row.unidad, align: 'center', color: [55, 59, 94], bold: false, fontSize: 8.1 },
                    ...row.gestiones.map(dias => ({ width: gestWidth, text: dias > 0 ? fmt(dias) : '—', align: 'center', color: dias > 0 ? [27, 37, 89] : [187, 187, 187], bold: dias > 0, fontSize: 8.6 })),
                    { width: fixedWidths.total, text: fmt(row.total), align: 'center', color: [114, 0, 53], bold: true, fontSize: 8.4 },
                    ...(puedeVerDiasPerdidos ? [{ width: fixedWidths.perdidos, text: fmt(row.perdidos || 0), align: 'center', color: [114, 0, 53], bold: true, fontSize: 8.4 }] : []),
                ];

                let rowHeight = 9;
                cellData.forEach(cell => {
                    doc.setFont('helvetica', cell.bold ? 'bold' : 'normal');
                    doc.setFontSize(cell.fontSize);
                    const lines = doc.splitTextToSize(cell.text, cell.width - 4);
                    rowHeight = Math.max(rowHeight, (lines.length * (cell.fontSize * 0.42)) + 4.2);
                });

                if (y + rowHeight > pageHeight - 10) {
                    doc.addPage();
                    y = rowStartY;
                }

                let x = marginX;
                cellData.forEach(cell => {
                    doc.setFillColor(...fill);
                    doc.setDrawColor(...border);
                    doc.setLineWidth(0.15);
                    doc.rect(x, y, cell.width, rowHeight, 'FD');

                    doc.setFont('helvetica', cell.bold ? 'bold' : 'normal');
                    doc.setFontSize(cell.fontSize);
                    doc.setTextColor(...cell.color);
                    const lines = doc.splitTextToSize(cell.text, cell.width - 4);
                    const lineHeight = cell.fontSize * 0.42;
                    const blockHeight = lines.length * lineHeight;
                    const startY = y + ((rowHeight - blockHeight) / 2) + lineHeight;

                    doc.text(lines, cell.align === 'left' ? (x + 2.5) : (x + (cell.width / 2)), startY, {
                        align: cell.align,
                        baseline: 'middle',
                    });
                    x += cell.width;
                });

                return y + rowHeight;
            };

            drawDocumentHeader();
            drawTableHeader(firstHeaderY, firstTopHeaderH, firstSubHeaderH);

            let currentY = firstRowY;
            rows.forEach((row, index) => {
                currentY = drawRow(row, currentY, index, repeatRowY);
            });

            const dd    = String(hoy.getDate()).padStart(2, '0');
            const mm    = String(hoy.getMonth() + 1).padStart(2, '0');
            const yyyy  = hoy.getFullYear();
            doc.save(`Reporte_General_${dd}-${mm}-${yyyy}.pdf`);
        } catch (err) {
            console.error('Error generando PDF general:', err);
            alert('No se pudo generar el PDF. Intente nuevamente.');
        }
    }

    // ══════════════════════════════════════════════
    // UTILIDADES
    // ══════════════════════════════════════════════
    function fmt(n) {
        return n % 1 === 0 ? String(n) : n.toFixed(1);
    }

    function esc(s) {
        return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function nombreMes(n) {
        return ['enero','febrero','marzo','abril','mayo','junio',
                'julio','agosto','septiembre','octubre','noviembre','diciembre'][n];
    }

    async function cargarImagenBase64(url) {
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) {
            throw new Error(`No se pudo cargar la imagen: ${url}`);
        }
        const blob = await resp.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // Descarga un PDF directamente (sin abrir pestaña ni diálogo de impresión)
    // a partir de un documento HTML completo, usando html2pdf.js sobre un
    // iframe oculto para no filtrar los estilos del PDF a la página actual.
    function descargarPDFDesdeHTML(htmlCompleto, filename, orientation = 'landscape') {
        if (typeof html2pdf === 'undefined') {
            alert('No se pudo cargar el generador de PDF (posible bloqueo de red, firewall o extensión del navegador). Verifique su conexión e intente de nuevo.');
            return;
        }

        const iframe = document.createElement('iframe');
        iframe.style.position = 'absolute';
        iframe.style.left     = '-9999px';
        iframe.style.top      = '0';
        iframe.style.width    = orientation === 'landscape' ? '1122px' : '794px';
        iframe.style.height   = orientation === 'landscape' ? '794px' : '1122px';
        iframe.style.border   = '0';
        iframe.style.backgroundColor = '#ffffff';
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

                    const objetivo = doc.getElementById('rg-general-pdf') || doc.body;
                    await html2pdf().from(objetivo).set({
                        margin: 0,
                        filename,
                        image: { type: 'jpeg', quality: 0.98 },
                        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
                        jsPDF: { unit: 'pt', format: 'a4', orientation },
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

    init();
});
