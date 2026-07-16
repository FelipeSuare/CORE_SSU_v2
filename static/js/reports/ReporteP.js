document.addEventListener('DOMContentLoaded', () => {

    // ══════════════════════════════════════════════
    // ESTADO DEL MÓDULO
    // ══════════════════════════════════════════════
    let todosFuncionarios         = [];
    let areaLabel                 = 'RECURSOS HUMANOS';
    let nombreRRHH                = '';
    let funcionarioHistorialActual = null;
    let rangoDesde                = null;
    let rangoHasta                = null;

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
    // CARGA DE UNIDADES (+ contexto del usuario)
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
    // CARGA DE FUNCIONARIOS DESDE LA API
    // ══════════════════════════════════════════════
    async function cargarFuncionarios(params = {}) {
        const tbody = document.getElementById('tablaBody');
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:#aaa">
            <i class="material-symbols-outlined" style="vertical-align:middle">hourglass_empty</i> Cargando…
        </td></tr>`;

        const qs = new URLSearchParams(params).toString();
        try {
            const res  = await fetch(`/api/reportes/personal/funcionarios/${qs ? '?' + qs : ''}`);
            const data = await res.json();
            if (data.error) {
                tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:28px;color:#c00">${data.error}</td></tr>`;
                return;
            }
            todosFuncionarios = data.funcionarios;
            actualizarHeadersGestion();
            renderTabla(todosFuncionarios);
        } catch (e) {
            console.error('Error cargando funcionarios:', e);
            document.getElementById('tablaBody').innerHTML =
                `<tr><td colspan="9" style="text-align:center;padding:28px;color:#c00">Error al cargar datos.</td></tr>`;
        }
    }

    // ══════════════════════════════════════════════
    // CABECERAS GESTIÓN
    // ══════════════════════════════════════════════
    function actualizarHeadersGestion() {
        const base = new Date().getFullYear();
        ['thRP1','thRP2','thRP3'].forEach((id, i) => {
            const th = document.getElementById(id);
            if (th) th.textContent = base - i;
        });
    }

    // ══════════════════════════════════════════════
    // RENDERIZAR TABLA
    // ══════════════════════════════════════════════
    function renderTabla(datos) {
        const tbody = document.getElementById('tablaBody');
        tbody.innerHTML = '';

        document.getElementById('totalFuncionarios').textContent =
            `${datos.length} funcionario${datos.length !== 1 ? 's' : ''}`;

        if (datos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:#aaa">
                No se encontraron funcionarios con los criterios seleccionados.
            </td></tr>`;
            return;
        }

        datos.forEach(f => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${esc(f.nombre_completo)}</td>
                <td>${esc(f.cargo)}</td>
                <td>${f.fecha_ingreso}</td>
                ${f.gestiones.map((g, i) => celdaGestion(g, i)).join('')}
                ${celdaNegados(f)}
                ${celdaAdeudado(f)}
                <td class="td-accion">
                    <div class="cell-acciones">
                        <button class="btn-planilla" data-cod="${f.cod}" data-action="pdf"
                                title="Generar Acta de Vacaciones PDF">
                            <i class="material-symbols-outlined">picture_as_pdf</i>
                        </button>
                        <button class="btn-planilla btn-planilla-hist" data-cod="${f.cod}" data-action="historial"
                                title="Ver Historial de Solicitudes">
                            <i class="material-symbols-outlined">history</i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    function celdaGestion(g, i) {
        const base = new Date().getFullYear();
        const anioMostrar = g.anio !== null ? g.anio : (base - i);
        if (g.dias === 0) {
            return `<td><div class="gestion-cell">
                        <span class="gestion-anio">${anioMostrar}</span>
                        <span class="sin-dias">0</span>
                    </div></td>`;
        }
        return `<td><div class="gestion-cell">
                    <span class="gestion-anio">${anioMostrar}</span>
                    <span class="dias-val">${fmt(g.dias)}</span>
                </div></td>`;
    }

    function celdaNegados(f) {
        if (f.dias_negados <= 0) return `<td><span class="sin-dias">—</span></td>`;
        return `<td>
            <span class="dias-negados-val"
                  title="Registro histórico informativo. Ya repuestos en la gestión más antigua.">
                ${fmt(f.dias_negados)}
            </span>
        </td>`;
    }

    function celdaAdeudado(f) {
        return `<td><span class="dias-total">${fmt(f.dias_adeudados)}</span></td>`;
    }

    // ══════════════════════════════════════════════
    // FILTROS
    // ══════════════════════════════════════════════
    function aplicarFiltros() {
        const params   = {};
        const unidad   = document.getElementById('unidadOrg').value;
        const contrato = document.getElementById('tipoContrato').value;
        const nombre   = document.getElementById('funcionario').value.trim();
        if (unidad)   params.unidad        = unidad;
        if (contrato) params.tipo_contrato = contrato;
        if (nombre)   params.funcionario   = nombre;
        cargarFuncionarios(params);
    }

    document.getElementById('btnBuscar').addEventListener('click', aplicarFiltros);
    document.getElementById('funcionario').addEventListener('keypress', e => {
        if (e.key === 'Enter') aplicarFiltros();
    });
    document.getElementById('btnLimpiar').addEventListener('click', () => {
        document.getElementById('unidadOrg').value   = '';
        document.getElementById('tipoContrato').value = '';
        document.getElementById('funcionario').value  = '';
        cargarFuncionarios();
    });

    // ══════════════════════════════════════════════
    // DELEGACIÓN DE CLICS EN TABLA
    // ══════════════════════════════════════════════
    document.getElementById('tablaBody').addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const cod    = btn.dataset.cod;
        const action = btn.dataset.action;
        const f      = todosFuncionarios.find(x => x.cod === cod);
        if (!f) return;
        if (action === 'pdf')       generarActaPDF(f);
        if (action === 'historial') abrirHistorial(cod);
    });

    // ══════════════════════════════════════════════
    // MODAL HISTORIAL
    // ══════════════════════════════════════════════
    const modalHistorial = document.getElementById('modalHistorial');

    async function abrirHistorial(cod) {
        rangoDesde = null;
        rangoHasta = null;
        document.getElementById('anioDesde').value = '';
        document.getElementById('anioHasta').value = '';
        document.getElementById('histModalNombre').textContent  = '…';
        document.getElementById('histModalCargo').textContent   = '…';
        document.getElementById('histModalIngreso').textContent = '…';
        document.getElementById('histModalSaldo').textContent   = '…';
        document.getElementById('historialContenido').innerHTML =
            `<p style="text-align:center;padding:28px;color:#aaa">Cargando historial…</p>`;
        modalHistorial.classList.add('show');

        try {
            const res  = await fetch(`/api/reportes/personal/historial/?cod=${encodeURIComponent(cod)}`);
            const data = await res.json();
            if (data.error) {
                document.getElementById('historialContenido').innerHTML =
                    `<p style="color:#c00;text-align:center;padding:20px">${data.error}</p>`;
                return;
            }
            funcionarioHistorialActual = data;
            document.getElementById('histModalNombre').textContent  = data.nombre_completo;
            document.getElementById('histModalCargo').textContent   = data.cargo;
            document.getElementById('histModalIngreso').textContent = data.fecha_ingreso;
            document.getElementById('histModalSaldo').textContent   = `${fmt(data.dias_adeudados)} días`;
            renderHistorialContenido(data, null, null);
        } catch (e) {
            console.error('Error cargando historial:', e);
        }
    }

    function renderHistorialContenido(data, desde, hasta) {
        let gestiones = Object.keys(data.historial).sort((a, b) => b - a);

        if (desde !== null || hasta !== null) {
            gestiones = gestiones.filter(g => {
                const anio = parseInt(g);
                return (desde === null || anio >= desde) && (hasta === null || anio <= hasta);
            });
        }

        const contenido = document.getElementById('historialContenido');
        if (gestiones.length === 0) {
            contenido.innerHTML = `<p style="color:#aaa;text-align:center;padding:20px">
                Sin historial para el rango seleccionado.</p>`;
            return;
        }

        contenido.innerHTML = gestiones.map(g => {
            const solicitudes = data.historial[g] || [];
            const filas = solicitudes.length === 0
                ? `<tr><td colspan="5" style="text-align:center;color:#bbb;padding:12px">Sin solicitudes</td></tr>`
                : solicitudes.map(s => `
                    <tr>
                        <td>${s.nro}</td>
                        <td>${s.inicio}</td>
                        <td>${s.fin}</td>
                        <td>${fmt(s.dias)} día${s.dias !== 1 ? 's' : ''}</td>
                        <td>Aprobada</td>
                    </tr>`).join('');

            return `
                <div class="historial-bloque">
                    <div class="historial-bloque-header">
                        <span class="gest-label">
                            <i class="material-symbols-outlined">calendar_month</i> Gestión ${g}
                        </span>
                        <span class="badge">
                            ${solicitudes.length} solicitud${solicitudes.length !== 1 ? 'es' : ''}
                        </span>
                    </div>
                    <div class="historial-table-wrap">
                        <table class="historial-table">
                            <thead>
                                <tr><th>Nro.</th><th>Inicio</th><th>Fin</th><th>Días</th><th>Estado</th></tr>
                            </thead>
                            <tbody>${filas}</tbody>
                        </table>
                    </div>
                </div>`;
        }).join('');
    }

    document.getElementById('btnAplicarRango').addEventListener('click', () => {
        if (!funcionarioHistorialActual) return;
        const vD = parseInt(document.getElementById('anioDesde').value);
        const vH = parseInt(document.getElementById('anioHasta').value);
        rangoDesde = (!isNaN(vD) && vD >= 2000) ? vD : null;
        rangoHasta = (!isNaN(vH) && vH >= 2000) ? vH : null;

        if (rangoDesde !== null && rangoHasta !== null && rangoDesde > rangoHasta) {
            ['anioDesde', 'anioHasta'].forEach(id => {
                const el = document.getElementById(id);
                el.style.borderColor = 'red';
                setTimeout(() => (el.style.borderColor = ''), 1500);
            });
            return;
        }
        renderHistorialContenido(funcionarioHistorialActual, rangoDesde, rangoHasta);
    });

    document.getElementById('btnLimpiarRango').addEventListener('click', () => {
        if (!funcionarioHistorialActual) return;
        rangoDesde = null;
        rangoHasta = null;
        document.getElementById('anioDesde').value = '';
        document.getElementById('anioHasta').value = '';
        renderHistorialContenido(funcionarioHistorialActual, null, null);
    });

    document.getElementById('closeHistorial').addEventListener('click', () =>
        modalHistorial.classList.remove('show'));
    window.addEventListener('click', e => {
        if (e.target === modalHistorial) modalHistorial.classList.remove('show');
    });

    document.getElementById('btnDescargarHistorial').addEventListener('click', () => {
        if (funcionarioHistorialActual) {
            generarHistorialPDF(funcionarioHistorialActual, rangoDesde, rangoHasta);
        }
    });

    // ══════════════════════════════════════════════
    // PDF: HISTORIAL DE SOLICITUDES
    // ══════════════════════════════════════════════
    function generarHistorialPDF(data, desde, hasta) {
        const hoy       = new Date();
        const fechaStr  = `Trinidad, ${hoy.getDate()} de ${nombreMes(hoy.getMonth())} de ${hoy.getFullYear()}`;
        const rangoLabel = (desde || hasta) ? ` (${desde ?? '…'} – ${hasta ?? '…'})` : '';

        let gestiones = Object.keys(data.historial).sort((a, b) => b - a);
        if (desde !== null || hasta !== null) {
            gestiones = gestiones.filter(g => {
                const anio = parseInt(g);
                return (desde === null || anio >= desde) && (hasta === null || anio <= hasta);
            });
        }

        const bloques = gestiones.map(g => {
            const solicitudes = data.historial[g] || [];
            const filas = solicitudes.length === 0
                ? `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:10px">Sin solicitudes</td></tr>`
                : solicitudes.map(s => `
                    <tr>
                        <td>${s.nro}</td>
                        <td>${s.inicio}</td>
                        <td>${s.fin}</td>
                        <td>${fmt(s.dias)} día${s.dias !== 1 ? 's' : ''}</td>
                        <td>Aprobada</td>
                    </tr>`).join('');
            return `
                <div class="bloque">
                    <div class="bloque-header">
                        <span>Gestión ${g}</span>
                        <span>${solicitudes.length} solicitud${solicitudes.length !== 1 ? 'es' : ''}</span>
                    </div>
                    <table>
                        <thead>
                            <tr><th>Nro.</th><th>Fecha Inicio</th><th>Fecha Fin</th><th>Días</th><th>Estado</th></tr>
                        </thead>
                        <tbody>${filas}</tbody>
                    </table>
                </div>`;
        }).join('');

        const T = PDF_THEME.html;
        descargarPDFDesdeHTML(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap');
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Montserrat',Arial,sans-serif;padding:36px 44px;font-size:10px;color:${T.textNavyMuted};background:#fff;}
    .inst-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;padding-bottom:12px;border-bottom:2px solid ${T.navy};}
    .inst-nombre{font-size:13px;font-weight:700;color:${T.navy};text-transform:uppercase;line-height:1.6;}
    .inst-fecha{font-size:10px;color:${T.grayDate};text-align:right;line-height:1.6;}
    .titulo{text-align:center;margin-bottom:20px;}
    .titulo h2{color:${T.pink};font-size:17px;font-weight:800;letter-spacing:1px;text-transform:uppercase;}
    .datos{display:grid;grid-template-columns:1fr 1fr;gap:6px 30px;background:#f4f5fb;border:1px solid #e3e5ef;border-radius:6px;padding:12px 18px;margin-bottom:20px;}
    .dato{display:flex;gap:6px;align-items:baseline;}
    .dato-label{font-weight:700;color:${T.pink};font-size:9px;text-transform:uppercase;min-width:85px;}
    .dato-valor{font-weight:600;color:${T.navy};font-size:10px;}
    .bloque{margin-bottom:16px;}
    .bloque-header{background:${T.headerFillLight};color:${T.navy};padding:7px 14px;border-radius:6px 6px 0 0;display:flex;justify-content:space-between;font-weight:700;font-size:9.5px;}
    .bloque-header span:last-child{font-weight:400;opacity:0.7;}
    table{width:100%;border-collapse:collapse;font-size:9.5px;}
    thead th{background:${T.headerFillLight};color:${T.navy};padding:7px 10px;text-align:center;font-weight:700;text-transform:uppercase;border:1px solid ${T.borderLight};}
    td{padding:8px 10px;border:1px solid ${T.borderLight};text-align:center;}
    tbody tr:nth-child(even) td{background:${T.rowFillEven};}
</style></head><body>
    <div class="inst-header">
        <div style="display:flex;align-items:center;gap:14px;">
            <img src="/static/img/login/LOGOSSU.png" style="height:54px;width:auto;">
            <div class="inst-nombre">SEGURO SOCIAL UNIVERSITARIO<br>
                <span style="font-weight:400;font-size:10px;color:${T.grayLabel};letter-spacing:.5px">${areaLabel}</span>
            </div>
        </div>
        <div class="inst-fecha">${fechaStr}</div>
    </div>
    <div class="titulo"><h2>HISTORIAL SOLICITUDES${rangoLabel}</h2></div>
    <div class="datos">
        <div class="dato"><span class="dato-label">Funcionario:</span><span class="dato-valor">${esc(data.nombre_completo)}</span></div>
        <div class="dato"><span class="dato-label">Cargo:</span><span class="dato-valor">${esc(data.cargo)}</span></div>
        <div class="dato"><span class="dato-label">Fecha Ingreso:</span><span class="dato-valor">${data.fecha_ingreso}</span></div>
        <div class="dato"><span class="dato-label">Días disponibles:</span>
            <span class="dato-valor" style="color:${T.pink}">${fmt(data.dias_adeudados)} días</span></div>
    </div>
    ${bloques}
</body></html>`, `Historial_${_nombreArchivo(data.nombre_completo)}.pdf`, 'portrait');
    }

    // ══════════════════════════════════════════════
    // PDF: ACTA DE VACACIONES
    // ══════════════════════════════════════════════
    async function generarActaPDF(f) {
        const hoy = new Date();
        const fechaStr = `Trinidad, ${hoy.getDate()} de ${nombreMes(hoy.getMonth())} de ${hoy.getFullYear()}`;

        let gestionesReales = f.gestiones.filter(g => g.anio !== null && g.anio < hoy.getFullYear());
        if (gestionesReales.length === 0) {
            gestionesReales = f.gestiones.filter(g => g.anio !== null);
        }

        const firmaRRHH = nombreRRHH || 'Encargada de RR.HH.';

        const jsPDFCtor = window.jspdf?.jsPDF || window.jsPDF;
        if (!jsPDFCtor) {
            console.error('No se encontró jsPDF en el bundle cargado.');
            alert('No se pudo generar el PDF porque no está disponible el motor de exportación.');
            return;
        }

        try {
            const doc = new jsPDFCtor({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const left = 10;
            const right = 10;
            const contentWidth = pageWidth - left - right;
            const top = 9;

            const logoData = await cargarImagenBase64('/static/img/login/LOGOSSU.png');

            // Encabezado
            doc.addImage(logoData, 'PNG', left, top, 20, 20);
            doc.setTextColor(...PDF_THEME.navyHeaderText);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(16);
            doc.text('SEGURO SOCIAL UNIVERSITARIO', 34, 16);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...PDF_THEME.grayLabel);
            doc.setFontSize(10);
            doc.text(areaLabel, 34, 22);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...PDF_THEME.grayDate);
            doc.setFontSize(9.5);
            doc.text(fechaStr, pageWidth - right, 16, { align: 'right' });
            doc.setDrawColor(...PDF_THEME.navyHeaderText);
            doc.setLineWidth(0.8);
            doc.line(left, 31, pageWidth - right, 31);

            // Título
            doc.setTextColor(...PDF_THEME.pinkTitle);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(19);
            doc.text('VACACIONES PERSONAL', pageWidth / 2, 45, { align: 'center' });

            // Tabla
            const fixedWidths = {
                nombre: 71,
                cargo: 64,
                ingreso: 31,
                adeudado: 23,
            };
            const gestionesCount = Math.max(gestionesReales.length, 1);
            const gestionWidth = (contentWidth - fixedWidths.nombre - fixedWidths.cargo - fixedWidths.ingreso - fixedWidths.adeudado) / gestionesCount;
            const headerY = 53;
            const headerH = 15;

            const columns = [
                { label: 'APELLIDOS Y NOMBRES', width: fixedWidths.nombre, key: 'nombre' },
                { label: 'CARGO', width: fixedWidths.cargo, key: 'cargo' },
                { label: 'FECHA DE INGRESO', width: fixedWidths.ingreso, key: 'ingreso' },
                ...gestionesReales.map(g => ({ label: `GESTIÓN\n${g.anio}`, width: gestionWidth, key: `gestion-${g.anio}` })),
                { label: 'ADEUDADO', width: fixedWidths.adeudado, key: 'adeudado' },
            ];

            const rowValues = [
                { text: f.apellidos_nombres, type: 'left' },
                { text: f.cargo, type: 'left' },
                { text: f.fecha_ingreso, type: 'center' },
                ...gestionesReales.map(g => ({ text: fmt(g.dias), type: 'center' })),
                { text: fmt(f.dias_adeudados), type: 'total' },
            ];

            const rowY = headerY + headerH;
            const rowH = 21;

            let x = left;
            columns.forEach(col => {
                doc.setFillColor(...PDF_THEME.headerFill);
                doc.setDrawColor(...PDF_THEME.headerBorder);
                doc.setLineWidth(0.18);
                doc.rect(x, headerY, col.width, headerH, 'FD');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8.3);
                doc.setTextColor(...PDF_THEME.headerText);
                const headerLines = col.label.split('\n');
                doc.text(headerLines, x + col.width / 2, headerY + (headerH / 2), {
                    align: 'center',
                    baseline: 'middle',
                });
                x += col.width;
            });

            x = left;
            columns.forEach((col, index) => {
                doc.setFillColor(...PDF_THEME.rowFillEven);
                doc.setDrawColor(...PDF_THEME.rowBorder);
                doc.setLineWidth(0.15);
                doc.rect(x, rowY, col.width, rowH, 'FD');

                const value = rowValues[index];
                if (value.type === 'total') {
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(10.5);
                    doc.setTextColor(...PDF_THEME.pinkAccent);
                    doc.text(value.text, x + col.width / 2, rowY + (rowH / 2), { align: 'center', baseline: 'middle' });
                } else if (index === 0 || index === 1) {
                    doc.setFont('helvetica', index === 0 ? 'bold' : 'normal');
                    doc.setFontSize(index === 0 ? 9.8 : 9.2);
                    doc.setTextColor(...(index === 0 ? PDF_THEME.textNavyStrong : PDF_THEME.textNavyMuted));
                    const lines = doc.splitTextToSize(value.text, col.width - 4);
                    const textY = rowY + (rowH / 2) - (lines.length > 1 ? 1.5 : 0.2);
                    doc.text(lines, index === 0 ? x + 2.5 : x + col.width / 2, textY, {
                        baseline: 'middle',
                        align: index === 0 ? 'left' : 'center',
                    });
                } else if (index === 2 || index >= 3) {
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(9.1);
                    doc.setTextColor(...PDF_THEME.textNavyMuted);
                    doc.text(value.text, x + col.width / 2, rowY + (rowH / 2), { align: 'center', baseline: 'middle' });
                }
                x += col.width;
            });

            // Nota
            doc.setTextColor(123, 123, 127);
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(9.8);
            const nota = 'Firmo la presente planilla estando de acuerdo con el cálculo de vacaciones que se ha realizado hasta la fecha que indica arriba.';
            const notaLines = doc.splitTextToSize(nota, contentWidth - 24);
            doc.text(notaLines, pageWidth / 2, 103, { align: 'center' });

            // Firmas
            const lineY = pageHeight - 25;
            const sigWidth = 76;
            const leftSigX = 22;
            const rightSigX = pageWidth - 22 - sigWidth;

            doc.setDrawColor(...PDF_THEME.pinkTitle);
            doc.setLineWidth(0.45);
            doc.line(leftSigX, lineY, leftSigX + sigWidth, lineY);
            doc.line(rightSigX, lineY, rightSigX + sigWidth, lineY);

            doc.setTextColor(...PDF_THEME.navyHeaderText);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10.2);
            doc.text(firmaRRHH || 'Encargada de RR.HH.', leftSigX + sigWidth / 2, lineY + 9, { align: 'center' });
            doc.setTextColor(...PDF_THEME.pinkTitle);
            doc.setFontSize(9.5);
            doc.text('ENCARGADA DE RR.HH', leftSigX + sigWidth / 2, lineY + 14, { align: 'center' });

            doc.setTextColor(...PDF_THEME.navyHeaderText);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10.2);
            doc.text(f.nombre_firma, rightSigX + sigWidth / 2, lineY + 9, { align: 'center' });
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(92, 94, 110);
            doc.setFontSize(9.3);
            const cargoFirma = doc.splitTextToSize(f.cargo || '', sigWidth + 4);
            doc.text(cargoFirma, rightSigX + sigWidth / 2, lineY + 14, { align: 'center' });

            doc.save(`Reporte_Personal_${_nombreArchivo(f.apellidos_nombres)}.pdf`);
        } catch (err) {
            console.error('Error generando PDF del acta:', err);
            alert('No se pudo generar el PDF. Intente nuevamente.');
        }
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

    // ══════════════════════════════════════════════
    // UTILIDADES
    // ══════════════════════════════════════════════
    function _nombreArchivo(str) {
        return String(str || 'funcionario')
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-zA-Z0-9 _-]/g, '')
            .trim().replace(/\s+/g, '_');
    }

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

                    await html2pdf().from(doc.body).set({
                        margin: 0,
                        filename,
                        html2canvas: { scale: 2, useCORS: true },
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

    function fmt(n) {
        return n % 1 === 0 ? String(n) : n.toFixed(1);
    }

    function esc(s) {
        return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function nombreMes(n) {
        return ['enero','febrero','marzo','abril','mayo','junio',
                'julio','agosto','septiembre','octubre','noviembre','diciembre'][n];
    }

    init();
});
