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
        const cols  = modoUnico ? 8 : 11;
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
        return [base, base - 1, base - 2, base - 3];
    }

    function actualizarCabeceras() {
        ['thG1','thG2','thG3','thG4'].forEach((id, i) => {
            const th = document.getElementById(id);
            th.textContent   = GESTIONES[i];
            th.style.display = '';
        });
        thColspan.setAttribute('colspan', '4');
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
        const numCols     = 6 + gestActivas.length + 1;

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
        ['thG2','thG3','thG4'].forEach(id => (document.getElementById(id).style.display = 'none'));
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

    function generarPDFGeneral(datos) {
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

        // Filas de datos
        const filas = datos.map((f, idx) => {
            const tdsGest = gestActivas.map(anio => {
                const g    = f.gestiones.find(g => g.anio === anio);
                const dias = g ? g.dias : 0;
                return dias > 0
                    ? `<td class="td-dias">${fmt(dias)}</td>`
                    : `<td style="color:#bbb">—</td>`;
            }).join('');

            return `<tr>
                <td class="td-num">${idx + 1}</td>
                <td class="td-nombre">${esc(f.apellidos_nombres)}</td>
                <td>${esc(f.cargo)}</td>
                <td>${f.fecha_ingreso}</td>
                <td>${esc(f.tipo_contrato)}</td>
                <td>${esc(f.unidad)}</td>
                ${tdsGest}
                <td class="td-total">${fmt(calcTotalDias(f))}</td>
            </tr>`;
        }).join('');

        const htmlPDF = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap');
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Montserrat',Arial,sans-serif;padding:28px 36px;font-size:9px;color:#1a1a1a;}
    .inst-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;padding-bottom:10px;border-bottom:2px solid rgb(39,20,71);}
    .inst-nombre{font-size:11px;font-weight:700;color:rgb(39,20,71);text-transform:uppercase;letter-spacing:.5px;line-height:1.5;}
    .inst-fecha{font-size:9px;color:#555;text-align:right;line-height:1.6;}
    .titulo{text-align:center;margin-bottom:14px;}
    .titulo h2{background:rgb(39,20,71);color:#fff;display:inline-block;padding:7px 26px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;border-radius:4px;}
    .resumen{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center;font-size:9px;}
    .resumen-total{font-weight:700;color:rgb(39,20,71);}
    .resumen-sep{color:#bbb;}
    .resumen-filtro{color:rgb(114,0,53);font-weight:600;}
    table{width:100%;border-collapse:collapse;font-size:8px;margin-bottom:18px;}
    thead{background:linear-gradient(90deg,rgb(39,20,71),rgb(114,0,53));}
    thead th{color:#fff;padding:6px 5px;text-align:center;font-weight:700;font-size:7.5px;text-transform:uppercase;letter-spacing:.3px;border-right:1px solid rgba(255,255,255,.15);line-height:1.4;}
    thead th:last-child{border-right:none;}
    tbody td{padding:6px 5px;border-bottom:1px solid #f0e6ec;text-align:center;vertical-align:middle;}
    tbody tr:nth-child(even) td{background:#fdf6fa;}
    .td-num{color:#888;font-size:7.5px;width:24px;}
    .td-nombre{text-align:left!important;font-weight:700;color:rgb(39,20,71);padding-left:7px!important;}
    .td-dias{font-weight:700;color:rgb(39,20,71);}
    .td-total{font-weight:700;color:rgb(114,0,53);font-size:9.5px;background:#f8f5fb;}
    .firma-rrhh{margin-top:28px;width:220px;text-align:center;}
    .firma-linea{border-top:1.5px solid #333;margin-bottom:6px;}
    .firma-nombre{font-weight:700;font-size:9px;text-transform:uppercase;color:rgb(39,20,71);letter-spacing:.3px;}
    .firma-rol{font-size:8px;color:rgb(114,0,53);font-weight:600;text-transform:uppercase;margin-top:2px;}
    @media print{body{padding:16px 24px;}}
</style></head><body>
    <div class="inst-header">
        <div style="display:flex;align-items:center;gap:14px;">
            <img src="/static/img/login/LOGOSSU.png" style="height:54px;width:auto;">
            <div class="inst-nombre">SEGURO SOCIAL UNIVERSITARIO<br>
                <span style="font-weight:400;font-size:10px;color:#555">${areaLabel}</span>
            </div>
        </div>
        <div class="inst-fecha">${fechaStr}</div>
    </div>
    <div class="titulo"><h2>REPORTE GENERAL</h2></div>
    <div class="resumen">
        <span class="resumen-total">Total funcionarios: ${datos.length}</span>
        ${filtrosLabel ? `<span class="resumen-sep">|</span><span class="resumen-filtro">${filtrosLabel}</span>` : ''}
    </div>
    <table>
        <thead>
            <tr>
                <th rowspan="2">Nº</th>
                <th rowspan="2">Apellidos y Nombres</th>
                <th rowspan="2">Cargo</th>
                <th rowspan="2">Fecha Ingreso</th>
                <th rowspan="2">Contrato</th>
                <th rowspan="2">Unidad Org.</th>
                ${thsGestRow1}
                <th rowspan="2">Total Días</th>
            </tr>
            ${thsGestRow2 ? `<tr>${thsGestRow2}</tr>` : ''}
        </thead>
        <tbody>${filas}</tbody>
    </table>
    <div class="firma-rrhh">
        <div class="firma-linea"></div>
        <div class="firma-nombre">${nombreRRHH || 'Encargada de RR.HH.'}</div>
        <div class="firma-rol">ENCARGADA DE RR.HH</div>
    </div>
    <script>window.onload=()=>window.print();<\/script>
</body></html>`;

        const ventana = window.open('', '_blank');
        if (!ventana) {
            alert('El navegador bloqueó la ventana emergente. Permita ventanas emergentes para este sitio e intente de nuevo.');
            return;
        }
        ventana.document.write(htmlPDF);
        ventana.document.close();
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

    init();
});
