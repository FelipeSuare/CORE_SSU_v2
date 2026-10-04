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

// ── PDFs generados desde HTML (html2pdf): mismo encabezado, tipografía y
//    tablas que los reportes dibujados con jsPDF (Reporte General / Acta). ──
PDF_THEME.fechaLarga = (d = new Date()) => {
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                   'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return `Trinidad, ${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
};

PDF_THEME.htmlCss = (() => {
    const c = rgb => `rgb(${rgb.join(',')})`;
    const T = PDF_THEME;
    return `
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:Helvetica,Arial,sans-serif;font-size:10px;color:${c(T.textNavyMuted)};background:#fff;padding:28px 38px;}
    .inst-header{display:flex;justify-content:space-between;align-items:center;padding-bottom:10px;margin-bottom:14px;border-bottom:2.3px solid ${c(T.navyHeaderText)};}
    .inst-marca{display:flex;align-items:center;gap:12px;}
    .inst-marca img{height:46px;width:auto;}
    .inst-nombre{font-size:15px;font-weight:700;color:${c(T.navyHeaderText)};}
    .inst-area{font-size:10px;color:${c(T.grayLabel)};margin-top:3px;}
    .inst-fecha{font-size:9.5px;color:${c(T.grayDate)};align-self:flex-start;}
    .titulo{text-align:center;color:${c(T.pinkTitle)};font-size:19px;font-weight:700;text-transform:uppercase;margin:6px 0 16px;}
    .datos{display:grid;grid-template-columns:1fr 1fr;border:0.6px solid ${c(T.headerBorder)};margin-bottom:16px;}
    .dato{display:flex;gap:8px;align-items:baseline;padding:6px 10px;border-bottom:0.5px solid ${c(T.rowBorder)};background:${c(T.rowFillEven)};}
    .dato-label{font-weight:700;color:${c(T.pinkAccent)};font-size:8.5px;text-transform:uppercase;min-width:92px;}
    .dato-valor{font-weight:700;color:${c(T.textNavyStrong)};font-size:10px;}
    .bloque{margin-bottom:14px;page-break-inside:avoid;}
    .bloque-header{display:flex;justify-content:space-between;gap:12px;background:${c(T.headerFill)};color:${c(T.headerText)};border:0.6px solid ${c(T.headerBorder)};border-bottom:none;padding:6px 10px;font-weight:700;font-size:9.5px;text-transform:uppercase;}
    .bloque-header span:last-child{font-weight:400;text-transform:none;white-space:nowrap;}
    table{width:100%;border-collapse:collapse;font-size:9.2px;}
    thead th{background:${c(T.headerFill)};color:${c(T.headerText)};border:0.6px solid ${c(T.headerBorder)};padding:6px 8px;font-weight:700;font-size:8.3px;text-transform:uppercase;text-align:center;}
    td{border:0.5px solid ${c(T.rowBorder)};padding:7px 8px;text-align:center;color:${c(T.textNavyMuted)};background:${c(T.rowFillOdd)};}
    tbody tr:nth-child(even) td{background:${c(T.rowFillEven)};}
    td b, .fuerte{color:${c(T.textNavyStrong)};}
    .total{color:${c(T.pinkAccent)};font-weight:700;}
    .cero{color:rgb(187,187,187);}
    .nota{font-size:8.5px;color:rgb(123,123,127);font-style:italic;text-align:center;margin-top:12px;line-height:1.5;}
    .firma{width:240px;margin:56px 0 0 auto;text-align:center;}
    .firma-linea{border-top:1.3px solid ${c(T.pinkTitle)};margin-bottom:6px;}
    .firma-cargo{font-size:9.5px;font-weight:700;color:${c(T.pinkTitle)};text-transform:uppercase;}
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
    <div class="titulo">${titulo}</div>`;
