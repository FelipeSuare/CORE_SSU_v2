// Paleta compartida por los PDFs de Reporte General, Reporte Personal e
// Historial de Cargos.
// Único punto de verdad para que todos los reportes generen documentos con
// exactamente los mismos colores (antes cada archivo definía sus propios
// valores RGB/hex a mano y se iban desincronizando con el tiempo).
const PDF_THEME = {
    navyHeaderText: [31, 36, 101],
    grayLabel:      [130, 130, 138],
    grayDate:       [126, 126, 132],
    pinkTitle:      [161, 24, 75],
    pinkAccent:     [114, 0, 53],

    headerFill:   [217, 215, 234],
    headerBorder: [206, 210, 225],
    headerText:   [43, 47, 109],

    rowFillOdd:  [255, 255, 255],
    rowFillEven: [252, 247, 249],
    rowBorder:   [228, 229, 237],

    textNavyStrong: [27, 37, 89],
    textNavyMuted:  [55, 59, 94],
    textMuted:      [153, 153, 153],
};

// ── PDFs generados desde HTML (html2pdf: Historial de Cargos e Historial de
//    Solicitudes): misma estructura y paleta institucional que los PDFs del
//    servidor (constancia de acuerdo, vacations/views.py). ──
PDF_THEME.inst = {
    indigo: '#333399', vino: '#5C1033', blush: '#e8b4b8', navy: '#1e1e52', gris: '#6b6b7b',
    navyRgb: [30, 30, 82], grisRgb: [107, 107, 123],
};

PDF_THEME.fechaLarga = (d = new Date()) => {
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                   'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return `Trinidad, ${String(d.getDate()).padStart(2, '0')} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
};

PDF_THEME.htmlCss = (() => {
    const I = PDF_THEME.inst;
    const navy = '#2b2f6d', vino = '#a1184b', lila = '#d9d7ea', lilaClaro = '#f7f6fb', rosa = '#fdd1fb', linea = '#e4e5ed';
    return `
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:Helvetica,Arial,sans-serif;font-size:10px;color:#333;background:#fff;padding:0 46px;}
    .inst-header{display:flex;justify-content:space-between;align-items:center;padding-bottom:8px;}
    .inst-marca{display:flex;align-items:center;gap:14px;}
    .inst-marca img{height:56px;width:auto;}
    .inst-nombre{font-size:17px;font-weight:700;color:${navy};}
    .inst-area{font-size:10px;color:${I.gris};margin-top:2px;text-transform:uppercase;}
    .inst-fecha{font-size:9.5px;color:${I.gris};align-self:flex-start;margin-top:6px;}
    .inst-hr{border-top:2.5px solid ${navy};margin-bottom:18px;}
    .titulo{text-align:center;color:${vino};font-size:22px;font-weight:700;text-transform:uppercase;margin:4px 0 20px;}
    .datos{display:grid;grid-template-columns:1fr 1fr;row-gap:12px;margin-bottom:14px;font-size:9.5px;font-weight:700;}
    .datos .lbl{color:${vino};}
    .datos .val{color:${navy};}
    .seccion{color:${vino};font-size:12px;font-weight:700;text-transform:uppercase;margin:14px 0 8px;}
    .subseccion{color:${navy};font-size:10.5px;font-weight:700;text-transform:uppercase;margin:16px 0 8px;}
    .bloque{margin-bottom:22px;page-break-inside:avoid;}
    .bloque-header{background:${lila};padding:8px 10px;}
    .bloque-titulo{color:${navy};font-size:12.5px;font-weight:700;}
    .badge-actual{color:${vino};font-size:8.5px;font-weight:700;margin-left:16px;text-transform:uppercase;}
    .bloque-periodo{color:${vino};font-size:9px;margin-top:2px;}
    table{width:100%;border-collapse:collapse;}
    .tabla-cargo th{background:${lilaClaro};color:${navy};font-size:8.5px;font-weight:700;text-transform:uppercase;padding:9px 6px;border-left:1px solid ${linea};}
    .tabla-cargo td{font-size:12.5px;font-weight:700;color:#333;padding:10px 6px;text-align:center;border-left:1px solid ${linea};border-bottom:1px solid ${linea};}
    .tabla-cargo th:first-child,.tabla-cargo td:first-child{border-left:1px solid ${linea};}
    .tabla-cargo .ant{color:${vino};}
    .tabla-cargo .col-total{background:${rosa};border-left:0;}
    .tabla-cargo td.col-total.actual{color:${vino};}
    .tabla-vac th{background:${lila};color:${navy};font-size:9.5px;font-weight:700;text-transform:uppercase;padding:10px 6px;}
    .tabla-vac td{font-size:9.5px;color:#444;padding:10px 6px;text-align:center;border-left:1px solid ${linea};}
    .tabla-vac tbody tr:nth-child(even) td{background:#faf9fc;}
    .tabla-vac tbody tr:last-child td{border-bottom:1px solid ${linea};}
    .tabla-vac td:last-child{border-right:1px solid ${linea};}
    .tabla-vac td.aprobada{color:#2e7d32;font-weight:700;}
    .totales{margin:12px 0 24px;font-size:10px;font-weight:700;color:${vino};}
    .totales b{color:${navy};margin-right:16px;}
    .cero{color:rgb(170,170,170);}
    .nota{font-size:8px;color:${I.gris};margin-top:4px;}
    `;
})();

PDF_THEME.htmlEncabezado = (area, titulo) => `
    <div class="inst-header">
        <div class="inst-marca">
            <img src="/static/img/login/LOGOSSU.png">
            <div>
                <div class="inst-nombre">SEGURO SOCIAL UNIVERSITARIO</div>
                <div class="inst-area">${area}</div>
            </div>
        </div>
        <div class="inst-fecha">${PDF_THEME.fechaLarga()}</div>
    </div>
    <div class="inst-hr"></div>
    <div class="titulo">${titulo}</div>`;

// Fila de datos del funcionario (etiqueta vino + valor navy, en 2 columnas).
// `pares` = [[etiqueta, valorYaEscapado], ...]
PDF_THEME.htmlDatos = pares => `<div class="datos">${
    pares.map(([l, v]) => `<div><span class="lbl">${l}:</span> <span class="val">${v}</span></div>`).join('')
}</div>`;

// Pie de cada página, igual al de la constancia: línea navy, fecha de
// generación y "Página N". `pdf` es la instancia jsPDF de html2pdf (pt).
PDF_THEME.pieDePagina = pdf => {
    const I = PDF_THEME.inst;
    const w = pdf.internal.pageSize.getWidth(), h = pdf.internal.pageSize.getHeight();
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    const generado = `Generado el ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ` +
                     `${p2(d.getHours())}:${p2(d.getMinutes())} · Sistema de Gestión de Vacaciones - SSU`;
    for (let i = 1, n = pdf.internal.getNumberOfPages(); i <= n; i++) {
        pdf.setPage(i);
        pdf.setDrawColor(...I.navyRgb);
        pdf.setLineWidth(0.6);
        pdf.line(57, h - 42, w - 57, h - 42);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(...I.grisRgb);
        pdf.text(generado, 57, h - 31);
        pdf.text(`Página ${i}`, w - 57, h - 31, { align: 'right' });
    }
};
