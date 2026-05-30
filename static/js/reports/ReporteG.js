document.addEventListener('DOMContentLoaded', () => {

    // ══════════════════════════════════════════════
    // GESTIONES (4 relativas al año de referencia)
    // ══════════════════════════════════════════════
    const defaultYear = new Date().getFullYear();
    let GESTIONES = calcularGestiones(defaultYear);

    function calcularGestiones(anioBase) {
        return [
            String(anioBase - 3),
            String(anioBase - 2),
            String(anioBase - 1),
            String(anioBase)
        ];
    }

    function actualizarCabecerasGestiones() {
        ['thG1','thG2','thG3','thG4'].forEach((id, i) => {
            document.getElementById(id).textContent = GESTIONES[i];
        });
    }

    actualizarCabecerasGestiones();

    // Botón aplicar año
    document.getElementById('btnAnio').addEventListener('click', () => {
        const val = parseInt(document.getElementById('anioRef').value);
        if (!val || val < 2000 || val > 2099) {
            document.getElementById('anioRef').style.borderColor = 'red';
            setTimeout(() => document.getElementById('anioRef').style.borderColor = '', 1500);
            return;
        }
        GESTIONES = calcularGestiones(val);
        actualizarCabecerasGestiones();
        renderTabla(datosFiltrados);
    });

    document.getElementById('anioRef').addEventListener('keypress', e => {
        if (e.key === 'Enter') document.getElementById('btnAnio').click();
    });

    // ══════════════════════════════════════════════
    // DATOS DE PRUEBA
    // ══════════════════════════════════════════════
    const funcionarios = [
        {
            id: 1,
            nombre: 'Jesús Mariaca Guardia Hormando',
            cargo: 'Médico General M.T.',
            fechaIngreso: '01/11/2023',
            tipoContrato: 'Item',
            area: 'Salud',
            gestiones: { '2023': 0, '2024': 15, '2025': 0, '2026': 0 },
            diasDisponibles: 15,
        },
        {
            id: 2,
            nombre: 'Ana María Gómez Pérez',
            cargo: 'Jefe de Contabilidad',
            fechaIngreso: '01/03/2018',
            tipoContrato: 'Indefinido',
            area: 'Administrativa',
            gestiones: { '2023': 5, '2024': 10, '2025': 8, '2026': 2 },
            diasDisponibles: 25,
        },
        {
            id: 3,
            nombre: 'Carlos Alberto Vaca Ríos',
            cargo: 'Auxiliar Administrativo',
            fechaIngreso: '15/06/2020',
            tipoContrato: 'Item',
            area: 'Administrativa',
            gestiones: { '2023': 10, '2024': 0, '2025': 5, '2026': 0 },
            diasDisponibles: 15,
        },
        {
            id: 4,
            nombre: 'María Elena Suárez Vidal',
            cargo: 'Enfermera Profesional',
            fechaIngreso: '10/04/2019',
            tipoContrato: 'Item',
            area: 'Salud',
            gestiones: { '2023': 3, '2024': 12, '2025': 6, '2026': 0 },
            diasDisponibles: 21,
        },
        {
            id: 5,
            nombre: 'Roberto Flores Mamani',
            cargo: 'Técnico en Sistemas',
            fechaIngreso: '20/08/2021',
            tipoContrato: 'Indefinido',
            area: 'Administrativa',
            gestiones: { '2023': 0, '2024': 8, '2025': 10, '2026': 4 },
            diasDisponibles: 22,
        },
    ];

    let datosFiltrados = [...funcionarios];

    // ══════════════════════════════════════════════
    // MODO GESTIÓN ÚNICA
    // ══════════════════════════════════════════════
    let modoUnico = false;
    let gestionUnica = null;

    const toggleChk      = document.getElementById('toggleGestionUnica');
    const grupoUnico     = document.getElementById('grupoGestionUnica');
    const inputAnioUnico = document.getElementById('anioUnico');
    const thColspan      = document.querySelector('th.th-group-label');

    toggleChk.addEventListener('change', () => {
        modoUnico = toggleChk.checked;
        grupoUnico.style.display = modoUnico ? '' : 'none';
        document.getElementById('grupoAnioRef').style.display = modoUnico ? 'none' : '';

        if (!modoUnico) {
            // Volver a modo 4 gestiones
            gestionUnica = null;
            inputAnioUnico.value = '';
            actualizarModo();
        } else {
            // Si ya hay un año escrito en único, aplicarlo
            const val = parseInt(inputAnioUnico.value);
            if (val >= 2000 && val <= 2099) {
                gestionUnica = String(val);
                actualizarModo();
            }
        }
    });

    document.getElementById('btnAnioUnico').addEventListener('click', () => {
        const val = parseInt(inputAnioUnico.value);
        if (!val || val < 2000 || val > 2099) {
            inputAnioUnico.style.borderColor = 'red';
            setTimeout(() => inputAnioUnico.style.borderColor = '', 1500);
            return;
        }
        gestionUnica = String(val);
        actualizarModo();
    });

    inputAnioUnico.addEventListener('keypress', e => {
        if (e.key === 'Enter') document.getElementById('btnAnioUnico').click();
    });

    function actualizarModo() {
        if (modoUnico && gestionUnica) {
            // 1 sola columna
            thColspan.setAttribute('colspan', '1');
            document.getElementById('thG1').textContent = gestionUnica;
            document.getElementById('thG2').style.display = 'none';
            document.getElementById('thG3').style.display = 'none';
            document.getElementById('thG4').style.display = 'none';
        } else {
            // 4 columnas normales
            thColspan.setAttribute('colspan', '4');
            ['thG2','thG3','thG4'].forEach(id => document.getElementById(id).style.display = '');
            actualizarCabecerasGestiones();
        }
        renderTabla(datosFiltrados);
    }


    function renderTabla(datos) {
        const tbody = document.getElementById('tablaBody');
        tbody.innerHTML = '';

        document.getElementById('totalFuncionarios').textContent =
            `${datos.length} funcionario${datos.length !== 1 ? 's' : ''}`;

        const gestActivas = (modoUnico && gestionUnica) ? [gestionUnica] : GESTIONES;

        if (datos.length === 0) {
            const cols = 5 + gestActivas.length + 1;
            tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center;padding:28px;color:#aaa">
                No se encontraron funcionarios con los criterios seleccionados.
            </td></tr>`;
            return;
        }

        datos.forEach(f => {
            const tr = document.createElement('tr');

            const celdaG = (g) => {
                const d = f.gestiones[g] || 0;
                return d > 0
                    ? `<td><span class="dias-val">${d}</span></td>`
                    : `<td><span class="sin-dias">—</span></td>`;
            };

            const diasMostrados = gestActivas.reduce((a, g) => a + (f.gestiones[g] || 0), 0);

            tr.innerHTML = `
                <td>${f.nombre}</td>
                <td>${f.cargo}</td>
                <td>${f.fechaIngreso}</td>
                <td><span class="badge-contrato">${f.tipoContrato}</span></td>
                <td><span class="badge-area">${f.area}</span></td>
                ${gestActivas.map(g => celdaG(g)).join('')}
                <td><span class="dias-total">${diasMostrados}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }

    renderTabla(funcionarios);

    // ══════════════════════════════════════════════
    // FILTROS
    // ══════════════════════════════════════════════
    function aplicarFiltros() {
        const contrato = document.getElementById('tipoContrato').value;
        const area     = document.getElementById('area').value;
        const nombre   = document.getElementById('funcionario').value.toLowerCase().trim();

        datosFiltrados = funcionarios.filter(f => {
            const okContrato = !contrato || f.tipoContrato === contrato;
            const okArea     = !area     || f.area === area;
            const okNombre   = !nombre   || f.nombre.toLowerCase().includes(nombre);
            return okContrato && okArea && okNombre;
        });

        renderTabla(datosFiltrados);
    }

    document.getElementById('btnBuscar').addEventListener('click', aplicarFiltros);
    document.getElementById('funcionario').addEventListener('keypress', e => {
        if (e.key === 'Enter') aplicarFiltros();
    });
    document.getElementById('btnLimpiar').addEventListener('click', () => {
        document.getElementById('tipoContrato').value = '';
        document.getElementById('area').value = '';
        document.getElementById('funcionario').value = '';
        document.getElementById('anioRef').value = '';
        // Resetear modo único
        modoUnico = false;
        gestionUnica = null;
        toggleChk.checked = false;
        grupoUnico.style.display = 'none';
        inputAnioUnico.value = '';
        document.getElementById('grupoAnioRef').style.display = '';
        thColspan.setAttribute('colspan', '4');
        ['thG2','thG3','thG4'].forEach(id => document.getElementById(id).style.display = '');
        // Resetear gestiones
        GESTIONES = calcularGestiones(defaultYear);
        actualizarCabecerasGestiones();
        datosFiltrados = [...funcionarios];
        renderTabla(datosFiltrados);
    });

    // ══════════════════════════════════════════════
    // EXPORTAR PDF GENERAL
    // ══════════════════════════════════════════════
    document.getElementById('btnExportarPDF').addEventListener('click', () => {
        generarPDFGeneral(datosFiltrados);
    });

    function generarPDFGeneral(datos) {
        if (datos.length === 0) return;

        const hoy = new Date();
        const fechaStr = `Trinidad, ${hoy.getDate()} de ${nombreMes(hoy.getMonth())} de ${hoy.getFullYear()}`;

        const gestActivas = (modoUnico && gestionUnica) ? [gestionUnica] : GESTIONES;

        // Cabeceras de gestión
        const thsGest = gestActivas.map(g => `<th>Gestión<br>${g}</th>`).join('');

        // Filas de la tabla
        const filas = datos.map((f, idx) => {
            const tdsGest = gestActivas.map(g => {
                const d = f.gestiones[g] || 0;
                return d > 0
                    ? `<td class="td-dias">${d}</td>`
                    : `<td style="color:#bbb">—</td>`;
            }).join('');

            const diasMostrados = gestActivas.reduce((a, g) => a + (f.gestiones[g] || 0), 0);

            return `
                <tr>
                    <td class="td-num">${idx + 1}</td>
                    <td class="td-nombre">${f.nombre}</td>
                    <td>${f.cargo}</td>
                    <td>${f.fechaIngreso}</td>
                    <td>${f.tipoContrato}</td>
                    <td>${f.area}</td>
                    ${tdsGest}
                    <td class="td-total">${diasMostrados}</td>
                </tr>`;
        }).join('');

        const htmlPDF = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
        font-family:'Montserrat',Arial,sans-serif;
        padding: 30px 36px;
        font-size: 9px;
        color: #1a1a1a;
    }

    /* Encabezado institucional */
    .inst-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 20px;
        padding-bottom: 12px;
        border-bottom: 2px solid rgb(39,20,71);
    }
    .inst-nombre {
        font-size: 11px;
        font-weight: 700;
        color: rgb(39,20,71);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        line-height: 1.5;
    }
    .inst-fecha {
        font-size: 9.5px;
        color: #555;
        text-align: right;
        line-height: 1.6;
    }

    /* Título */
    .planilla-titulo {
        text-align: center;
        margin-bottom: 18px;
    }
    .planilla-titulo h2 {
        background: rgb(39,20,71);
        color: #fff;
        display: inline-block;
        padding: 8px 28px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        border-radius: 4px;
    }

    /* Resumen */
    .resumen {
        display: flex;
        gap: 20px;
        margin-bottom: 16px;
    }
    .resumen-item {
        background: #f8f5fb;
        border: 1px solid #ddd;
        border-radius: 5px;
        padding: 7px 14px;
        font-size: 9px;
    }
    .resumen-item span { font-weight: 700; color: rgb(39,20,71); }

    /* Tabla general */
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 8.5px;
        margin-bottom: 20px;
    }
    thead tr th {
        background: rgb(39,20,71);
        color: #fff;
        padding: 7px 6px;
        text-align: center;
        font-weight: 700;
        font-size: 8px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        border: 1px solid #55366a;
        line-height: 1.4;
    }
    tbody td {
        padding: 7px 6px;
        border: 1px solid #ddd;
        text-align: center;
        vertical-align: middle;
    }
    tbody tr:nth-child(even) td { background: #fdf5f8; }
    .td-num    { color: #888; font-size: 8px; }
    .td-nombre { text-align: left; font-weight: 700; color: rgb(39,20,71); padding-left: 8px; }
    .td-dias   { font-weight: 700; color: rgb(39,20,71); }
    .td-total  { font-weight: 700; color: rgb(114,0,53); font-size: 10px; background: #f8f5fb; }


    /* Pie */
    .nota {
        font-size: 8.5px;
        color: #666;
        font-style: italic;
        border-left: 3px solid rgb(114,0,53);
        padding-left: 10px;
        margin-bottom: 30px;
        line-height: 1.6;
    }
    .firma-rrhh {
        margin-top: 30px;
        width: 220px;
        text-align: center;
    }
    .firma-linea {
        border-top: 1.5px solid #333;
        margin-bottom: 6px;
    }
    .firma-nombre {
        font-weight: 700;
        font-size: 9px;
        text-transform: uppercase;
        color: rgb(39,20,71);
        letter-spacing: 0.3px;
    }
    .firma-cargo { font-size: 8px; color: #666; margin-top: 2px; }

    @media print { body { padding: 20px 28px; } }
</style>
</head>
<body>

    <div class="inst-header">
        <div class="inst-nombre">
            Servicio Departamental de Salud<br>
            <span style="font-weight:400;font-size:10px;color:#555">Recursos Humanos</span>
        </div>
        <div class="inst-fecha">${fechaStr}</div>
    </div>

    <div class="planilla-titulo">
        <h2>Reporte General de Vacaciones — SSU</h2>
    </div>

    <div class="resumen">
        <div class="resumen-item">Total funcionarios: <span>${datos.length}</span></div>
        <div class="resumen-item">Gestión${gestActivas.length > 1 ? 'es' : ''}: <span>${gestActivas.join(' · ')}</span></div>
        <div class="resumen-item">Total días disponibles: <span>${datos.reduce((a,f) => a + gestActivas.reduce((b,g) => b + (f.gestiones[g]||0), 0), 0)}</span></div>
    </div>

    <table>
        <thead>
            <tr>
                <th>#</th>
                <th>Apellidos y Nombres</th>
                <th>Cargo</th>
                <th>Fecha Ingreso</th>
                <th>Contrato</th>
                <th>Área</th>
                ${thsGest}
                <th>Total<br>Días</th>
            </tr>
        </thead>
        <tbody>
            ${filas}
        </tbody>
    </table>

    <p class="nota">
        Los funcionarios firman la presente planilla estando de acuerdo con el cálculo de vacaciones realizado hasta la fecha indicada.
    </p>

    <div class="firma-rrhh">
        <div class="firma-linea"></div>
        <div class="firma-nombre">Encargada de RR.HH.</div>
    </div>

    <script>window.onload = () => window.print();<\/script>
</body>
</html>`;

        const ventana = window.open('', '_blank');
        ventana.document.write(htmlPDF);
        ventana.document.close();
    }

    // ══════════════════════════════════════════════
    // UTILIDAD: nombre de mes
    // ══════════════════════════════════════════════
    function nombreMes(n) {
        return ['enero','febrero','marzo','abril','mayo','junio',
                'julio','agosto','septiembre','octubre','noviembre','diciembre'][n];
    }
});
