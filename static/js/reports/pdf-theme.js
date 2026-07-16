// Paleta compartida por los PDFs de Reporte General y Reporte Personal.
// Único punto de verdad para que ambos reportes generen documentos con
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

    html: {
        navy:           '#1b2559',
        headerFillLight: '#dde1f2',
        borderLight:     '#eceefa',
        rowFillEven:     '#fdf3f7',
        pink:            'rgb(114,0,53)',
        grayLabel:       '#82828a',
        grayDate:        '#7e7e84',
        textNavyMuted:   '#373b5e',
    },
};
