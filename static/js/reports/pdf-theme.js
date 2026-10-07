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
    const blushBg = 'rgba(232,180,184,0.45)', indigoBg = 'rgba(51,51,153,0.22)', grid = 'rgba(51,51,153,0.3)';
    return `
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:Helvetica,Arial,sans-serif;font-size:10px;color:#000;background:#fff;padding:0 46px;}
    .inst-header{display:flex;justify-content:space-between;align-items:center;padding-bottom:6px;}
    .inst-marca{display:flex;align-items:center;gap:12px;}
    .inst-marca img{height:60px;width:auto;}
    .inst-nombre{font-size:14px;font-weight:700;color:${I.indigo};}
    .inst-area{font-size:9px;color:${I.gris};margin-top:3px;text-transform:uppercase;}
    .inst-fecha{font-size:9.5px;font-weight:700;color:${I.gris};align-self:flex-start;}
    .inst-hr{border-top:2.5px solid ${I.navy};margin-bottom:16px;}
    .titulo{text-align:center;color:${I.vino};font-size:13px;font-weight:700;text-transform:uppercase;margin:4px 0 16px;}
    .seccion{color:${I.vino};font-size:11px;font-weight:700;margin:14px 0 6px;}
    .datos{display:grid;grid-template-columns:1fr 1fr;border:0.6px solid ${grid};margin-bottom:16px;}
    .dato{display:grid;grid-template-columns:42% 58%;border:0.5px solid ${grid};}
    .dato-label{background:${blushBg};font-weight:700;color:${I.indigo};font-size:9px;padding:6px 8px;}
    .dato-valor{color:#000;font-size:9.5px;padding:6px 8px;}
    .bloque{margin-bottom:14px;page-break-inside:avoid;}
    .bloque-header{display:flex;justify-content:space-between;gap:12px;color:${I.vino};border-bottom:1px solid ${I.vino};padding:4px 2px;margin-bottom:6px;font-weight:700;font-size:10.5px;text-transform:uppercase;}
    .bloque-header span:last-child{font-weight:400;color:${I.gris};text-transform:none;white-space:nowrap;font-size:9px;}
    table{width:100%;border-collapse:collapse;font-size:9.5px;}
    thead th{background:${indigoBg};color:${I.indigo};border:0.5px solid ${grid};padding:6px 8px;font-weight:700;font-size:9px;text-align:center;}
    td{border:0.5px solid ${grid};padding:6px 8px;text-align:center;color:#000;background:#fff;}
    td b, .fuerte{color:${I.navy};}
    .total{color:${I.vino};font-weight:700;}
    .cero{color:rgb(187,187,187);}
    .nota{font-size:8.5px;color:${I.gris};font-style:italic;text-align:center;margin-top:12px;line-height:1.5;}
    .firma{width:240px;margin:64px 0 0 auto;text-align:center;page-break-inside:avoid;}
    .firma-linea{border-top:1.5px solid ${I.navy};margin-bottom:6px;}
    .firma-cargo{font-size:9px;font-weight:700;color:${I.vino};text-transform:uppercase;}
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
