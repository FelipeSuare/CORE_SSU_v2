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
            historial: {
                '2023': [],
                '2024': [
                    { nro: 1, inicio: '03/03/2024', fin: '10/03/2024', dias: 8, estado: 'Aprobada' },
                    { nro: 2, inicio: '15/07/2024', fin: '21/07/2024', dias: 7, estado: 'Aprobada' },
                ],
                '2025': [],
                '2026': [],
            }
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
            historial: {
                '2020': [
                    { nro: 1, inicio: '15/01/2020', fin: '17/01/2020', dias: 3, estado: 'Aprobada' },
                    { nro: 2, inicio: '10/07/2020', fin: '11/07/2020', dias: 2, estado: 'Aprobada' },
                ],
                '2021': [
                    { nro: 1, inicio: '05/02/2021', fin: '07/02/2021', dias: 3, estado: 'Aprobada' },
                ],
                '2022': [
                    { nro: 1, inicio: '10/02/2022', fin: '12/02/2022', dias: 3, estado: 'Aprobada' },
                    { nro: 2, inicio: '20/11/2022', fin: '20/11/2022', dias: 1, estado: 'Aprobada' },
                ],
                '2023': [
                    { nro: 1, inicio: '03/01/2023', fin: '04/01/2023', dias: 2, estado: 'Aprobada' },
                    { nro: 2, inicio: '20/12/2023', fin: '21/12/2023', dias: 3, estado: 'Aprobada' },
                ],
                '2024': [
                    { nro: 1, inicio: '05/01/2024', fin: '07/01/2024', dias: 3, estado: 'Aprobada' },
                    { nro: 2, inicio: '15/04/2024', fin: '16/04/2024', dias: 2, estado: 'Aprobada' },
                    { nro: 3, inicio: '10/06/2024', fin: '14/06/2024', dias: 5, estado: 'Aprobada' },
                ],
                '2025': [
                    { nro: 1, inicio: '10/01/2025', fin: '14/01/2025', dias: 5, estado: 'Aprobada' },
                    { nro: 2, inicio: '20/03/2025', fin: '22/03/2025', dias: 3, estado: 'Pendiente' },
                ],
                '2026': [
                    { nro: 1, inicio: '10/02/2026', fin: '11/02/2026', dias: 2, estado: 'Pendiente' },
                ],
            }
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
            historial: {
                '2023': [
                    { nro: 1, inicio: '02/04/2023', fin: '11/04/2023', dias: 10, estado: 'Aprobada' },
                ],
                '2024': [],
                '2025': [
                    { nro: 1, inicio: '18/02/2025', fin: '22/02/2025', dias: 5, estado: 'Aprobada' },
                ],
                '2026': [],
            }
        },
    ];

    let datosFiltrados = [...funcionarios];

    // ══════════════════════════════════════════════
    // RENDERIZAR TABLA
    // ══════════════════════════════════════════════
    function renderTabla(datos) {
        const tbody = document.getElementById('tablaBody');
        tbody.innerHTML = '';

        document.getElementById('totalFuncionarios').textContent =
            `${datos.length} funcionario${datos.length !== 1 ? 's' : ''}`;

        if (datos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:28px;color:#aaa">
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

            // Saber si tiene historial anterior ya no es necesario — botón siempre visible

            tr.innerHTML = `
                <td>${f.nombre}</td>
                <td>${f.cargo}</td>
                <td>${f.fechaIngreso}</td>
                ${celdaG(GESTIONES[0])}
                ${celdaG(GESTIONES[1])}
                ${celdaG(GESTIONES[2])}
                ${celdaG(GESTIONES[3])}
                <td><span class="dias-total">${f.diasDisponibles}</span></td>
                <td>
                    <div class="cell-acciones">
                        <button title="Generar Planilla PDF" class="btn-planilla" data-id="${f.id}" data-action="pdf">
                            <i class="material-symbols-outlined">picture_as_pdf</i>
                        </button>
                        <button title="Ver Historial" class="btn-planilla btn-planilla-hist" data-id="${f.id}" data-action="historial">
                            <i class="material-symbols-outlined">history</i>
                        </button>
                    </div>
                </td>
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
        GESTIONES = calcularGestiones(defaultYear);
        actualizarCabecerasGestiones();
        datosFiltrados = [...funcionarios];
        renderTabla(datosFiltrados);
    });

    // ══════════════════════════════════════════════
    // DELEGACIÓN DE CLICS EN TABLA
    // ══════════════════════════════════════════════
    document.getElementById('tablaBody').addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const id = parseInt(btn.dataset.id);
        const action = btn.dataset.action;
        if (action === 'pdf')      generarPlanillaPDF(id);
        if (action === 'historial') abrirHistorial(id);
    });

    // ══════════════════════════════════════════════
    // MODAL HISTORIAL
    // ══════════════════════════════════════════════
    const modalHistorial = document.getElementById('modalHistorial');

    function abrirHistorial(id) {
        const f = funcionarios.find(x => x.id === id);
        if (!f) return;

        document.getElementById('historialFuncionario').textContent = f.nombre;

        // Todas las gestiones ordenadas de más reciente a más antigua
        const todasGestiones = Object.keys(f.historial).sort((a, b) => b - a);

        const contenido = document.getElementById('historialContenido');
        if (todasGestiones.length === 0) {
            contenido.innerHTML = `<p style="color:#aaa;text-align:center;padding:20px">Sin historial disponible.</p>`;
        } else {
            contenido.innerHTML = todasGestiones.map(g => {
                const solicitudes = f.historial[g] || [];
                const filas = solicitudes.length === 0
                    ? `<tr><td colspan="5" style="text-align:center;color:#bbb;padding:12px">Sin solicitudes</td></tr>`
                    : solicitudes.map(s => `
                        <tr>
                            <td>${s.nro}</td>
                            <td>${s.inicio}</td>
                            <td>${s.fin}</td>
                            <td>${s.dias} día${s.dias !== 1 ? 's' : ''}</td>
                            <td>${s.estado}</td>
                        </tr>`).join('');

                return `
                    <div class="historial-bloque">
                        <div class="historial-bloque-header">
                            <span class="gest-label"><i class="material-symbols-outlined">calendar_month</i> Gestión ${g}</span>
                            <span class="badge">${solicitudes.length} solicitud${solicitudes.length !== 1 ? 'es' : ''}</span>
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

        funcionarioHistorialActual = f;
        modalHistorial.classList.add('show');
    }

    document.getElementById('closeHistorial').addEventListener('click', () => modalHistorial.classList.remove('show'));
    window.addEventListener('click', e => {
        if (e.target === modalHistorial) modalHistorial.classList.remove('show');
    });

    // Descargar historial completo como PDF
    let funcionarioHistorialActual = null;

    document.getElementById('btnDescargarHistorial').addEventListener('click', () => {
        if (funcionarioHistorialActual) generarHistorialPDF(funcionarioHistorialActual);
    });

    function generarHistorialPDF(f) {
        const hoy = new Date();
        const fechaStr = `Trinidad, ${hoy.getDate()} de ${nombreMes(hoy.getMonth())} de ${hoy.getFullYear()}`;
        const todasGest = Object.keys(f.historial).sort((a, b) => b - a);

        const bloques = todasGest.map(g => {
            const solicitudes = f.historial[g] || [];
            const filas = solicitudes.length === 0
                ? `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:10px">Sin solicitudes</td></tr>`
                : solicitudes.map(s => `
                    <tr>
                        <td>${s.nro}</td>
                        <td>${s.inicio}</td>
                        <td>${s.fin}</td>
                        <td>${s.dias} día${s.dias !== 1 ? 's' : ''}</td>
                        <td>${s.estado}</td>
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

        const htmlPDF = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Montserrat',Arial,sans-serif; padding:36px 44px; font-size:10px; color:#222; }

    .inst-header {
        display:flex; justify-content:space-between; align-items:flex-start;
        margin-bottom:22px; padding-bottom:12px;
        border-bottom:2px solid rgb(39,20,71);
    }
    .inst-nombre { font-size:11px; font-weight:700; color:rgb(39,20,71); text-transform:uppercase; line-height:1.5; }
    .inst-fecha  { font-size:10px; color:#555; text-align:right; line-height:1.6; }

    .titulo { text-align:center; margin-bottom:20px; }
    .titulo h2 {
        background:rgb(39,20,71); color:#fff;
        display:inline-block; padding:8px 28px;
        font-size:12px; font-weight:700; letter-spacing:1px;
        text-transform:uppercase; border-radius:4px;
    }

    .datos {
        display:grid; grid-template-columns:1fr 1fr;
        gap:6px 30px; background:#f8f5fb;
        border:1px solid #ddd; border-radius:6px;
        padding:12px 18px; margin-bottom:20px;
    }
    .dato { display:flex; gap:6px; align-items:baseline; }
    .dato-label { font-weight:700; color:rgb(114,0,53); font-size:9px; text-transform:uppercase; min-width:85px; }
    .dato-valor { font-weight:600; color:rgb(39,20,71); font-size:10px; }

    .bloque { margin-bottom:16px; }
    .bloque-header {
        background:rgb(39,20,71); color:#fff;
        padding:7px 14px; border-radius:6px 6px 0 0;
        display:flex; justify-content:space-between;
        font-weight:700; font-size:9.5px; letter-spacing:0.3px;
    }
    .bloque-header span:last-child { font-weight:400; opacity:0.8; }

    table { width:100%; border-collapse:collapse; font-size:9.5px; }
    thead th {
        background:rgb(114,0,53); color:#fff;
        padding:7px 10px; text-align:center;
        font-weight:700; text-transform:uppercase;
        letter-spacing:0.3px; border:1px solid #8a003e;
    }
    td { padding:8px 10px; border:1px solid #e0d0d8; text-align:center; }
    tbody tr:nth-child(even) td { background:#fdf5f8; }
    tbody tr:last-child { border-radius:0 0 6px 6px; }
</style>
</head>
<body>
    <div class="inst-header">
        <div class="inst-nombre">Servicio Departamental de Salud<br>
            <span style="font-weight:400;font-size:10px;color:#555">Recursos Humanos</span>
        </div>
        <div class="inst-fecha">${fechaStr}</div>
    </div>

    <div class="titulo"><h2>Historial de Vacaciones</h2></div>

    <div class="datos">
        <div class="dato">
            <span class="dato-label">Funcionario:</span>
            <span class="dato-valor">${f.nombre}</span>
        </div>
        <div class="dato">
            <span class="dato-label">Cargo:</span>
            <span class="dato-valor">${f.cargo}</span>
        </div>
        <div class="dato">
            <span class="dato-label">Fecha Ingreso:</span>
            <span class="dato-valor">${f.fechaIngreso}</span>
        </div>
        <div class="dato">
            <span class="dato-label">Días Disponibles:</span>
            <span class="dato-valor" style="color:rgb(114,0,53)">${f.diasDisponibles} días</span>
        </div>
    </div>

    ${bloques}

    <script>window.onload = () => window.print();<\/script>
</body>
</html>`;

        const ventana = window.open('', '_blank');
        ventana.document.write(htmlPDF);
        ventana.document.close();
    }

    // ══════════════════════════════════════════════
    // GENERAR PLANILLA PDF INDIVIDUAL
    // ══════════════════════════════════════════════
    function generarPlanillaPDF(id) {
        const f = funcionarios.find(x => x.id === id);
        if (!f) return;

        const hoy    = new Date();
        const dia    = String(hoy.getDate()).padStart(2, '0');
        const mes    = String(hoy.getMonth() + 1).padStart(2, '0');
        const anio   = hoy.getFullYear();
        const fechaStr = `Trinidad, ${dia} de ${nombreMes(hoy.getMonth())} de ${anio}`;

        // Solo gestiones con días > 0
        const gestionesConDias = GESTIONES.filter(g => (f.gestiones[g] || 0) > 0);

        // Cabeceras de gestión para la tabla
        const thsGestion = gestionesConDias
            .map(g => `<th>Gestión<br>${g}</th>`)
            .join('');

        // Fila del funcionario
        const tdsGestion = gestionesConDias
            .map(g => `<td>${f.gestiones[g]}</td>`)
            .join('');

        const htmlPDF = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
        font-family: 'Montserrat', Arial, sans-serif;
        background: #fff;
        padding: 40px 48px;
        color: #1a1a1a;
        font-size: 10.5px;
    }

    /* ── Encabezado institucional ── */
    .inst-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 28px;
        padding-bottom: 14px;
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
        font-size: 10px;
        color: #555;
        text-align: right;
        line-height: 1.6;
    }

    /* ── Título planilla ── */
    .planilla-titulo {
        text-align: center;
        margin-bottom: 22px;
    }
    .planilla-titulo h2 {
        background: rgb(39,20,71);
        color: #fff;
        display: inline-block;
        padding: 9px 32px;
        font-size: 12.5px;
        font-weight: 700;
        letter-spacing: 1.2px;
        text-transform: uppercase;
        border-radius: 4px;
    }

    /* ── Datos del funcionario ── */
    .datos-funcionario {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 40px;
        background: #f8f5fb;
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 14px 20px;
        margin-bottom: 22px;
    }
    .dato-item { display: flex; gap: 6px; align-items: baseline; }
    .dato-label {
        font-weight: 700;
        color: rgb(114,0,53);
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        white-space: nowrap;
        min-width: 90px;
    }
    .dato-valor {
        font-weight: 600;
        color: rgb(39,20,71);
        font-size: 10.5px;
    }

    /* ── Tabla de vacaciones ── */
    .tabla-vacaciones {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 22px;
        font-size: 10px;
    }
    .tabla-vacaciones th {
        background: rgb(39,20,71);
        color: #fff;
        padding: 9px 10px;
        text-align: center;
        font-weight: 700;
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        border: 1px solid #555;
        line-height: 1.4;
    }
    .tabla-vacaciones td {
        padding: 10px 10px;
        border: 1px solid #ccc;
        text-align: center;
        vertical-align: middle;
        font-weight: 600;
    }
    .tabla-vacaciones td.td-nombre { text-align: left; font-weight: 700; }
    .tabla-vacaciones td.td-dias { font-size: 12px; font-weight: 700; color: rgb(39,20,71); }
    .tabla-vacaciones td.td-total {
        font-size: 13px;
        font-weight: 700;
        color: rgb(114,0,53);
        background: #f8f5fb;
    }

    /* ── Nota de firma ── */
    .nota-firma {
        font-size: 9.5px;
        color: #555;
        font-style: italic;
        margin-bottom: 40px;
        line-height: 1.6;
        border-left: 3px solid rgb(114,0,53);
        padding-left: 12px;
    }

    /* ── Firmas ── */
    .firmas {
        display: flex;
        justify-content: space-between;
        margin-top: 20px;
    }
    .firma-bloque {
        width: 42%;
        text-align: center;
    }
    .firma-linea {
        border-top: 1.5px solid #333;
        margin-bottom: 8px;
    }
    .firma-nombre {
        font-weight: 700;
        font-size: 10px;
        text-transform: uppercase;
        color: rgb(39,20,71);
        letter-spacing: 0.3px;
    }
    .firma-cargo {
        font-size: 9px;
        color: #666;
        margin-top: 2px;
    }

    @media print {
        body { padding: 20px 30px; }
    }
</style>
</head>
<body>

    <!-- Encabezado institucional -->
    <div class="inst-header">
        <div class="inst-nombre">
            Servicio Departamental de Salud<br>
            <span style="font-weight:400;font-size:10px;color:#555">Recursos Humanos</span>
        </div>
        <div class="inst-fecha">
            ${fechaStr}
        </div>
    </div>

    <!-- Título -->
    <div class="planilla-titulo">
        <h2>Vacaciones Personal de Planta</h2>
    </div>

    <!-- Datos del funcionario -->
    <div class="datos-funcionario">
        <div class="dato-item">
            <span class="dato-label">Funcionario:</span>
            <span class="dato-valor">${f.nombre}</span>
        </div>
        <div class="dato-item">
            <span class="dato-label">Cargo:</span>
            <span class="dato-valor">${f.cargo}</span>
        </div>
        <div class="dato-item">
            <span class="dato-label">Fecha Ingreso:</span>
            <span class="dato-valor">${f.fechaIngreso}</span>
        </div>
        <div class="dato-item">
            <span class="dato-label">Días Disponibles:</span>
            <span class="dato-valor" style="color:rgb(114,0,53)">${f.diasDisponibles} días</span>
        </div>
    </div>

    <!-- Tabla de vacaciones -->
    <table class="tabla-vacaciones">
        <thead>
            <tr>
                <th>Apellidos y Nombres</th>
                <th>Cargo</th>
                <th>Fecha Ingreso</th>
                ${thsGestion}
                <th>Total<br>Días</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td class="td-nombre">${f.nombre}</td>
                <td>${f.cargo}</td>
                <td>${f.fechaIngreso}</td>
                ${tdsGestion}
                <td class="td-total">${f.diasDisponibles}</td>
            </tr>
        </tbody>
    </table>

    <!-- Nota -->
    <p class="nota-firma">
        Firmo la presente planilla estando de acuerdo con el cálculo de vacaciones que se ha realizado hasta la fecha que indica arriba.
    </p>

    <!-- Firmas -->
    <div class="firmas">
        <div class="firma-bloque">
            <div class="firma-linea"></div>
            <div class="firma-nombre">Encargada de RR.HH.</div>
        </div>
        <div class="firma-bloque">
            <div class="firma-linea"></div>
            <div class="firma-nombre">${f.nombre}</div>
            <div class="firma-cargo">${f.cargo}</div>
        </div>
    </div>

    <script>
        window.onload = () => {
            window.print();
        };
    <\/script>
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
